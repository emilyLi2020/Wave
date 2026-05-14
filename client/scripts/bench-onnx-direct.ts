// Direct ONNX Runtime test for our fine-tune, bypassing transformers.js.
//
// Our decoder takes input_ids directly (embedding op is inside the graph),
// and declares all 35 KV layers as separate inputs. transformers.js's
// Gemma 4 wiring assumes the upstream structure (decoder takes inputs_embeds
// + 15 KV layers with sharing), so it can't drive our model.
//
// This script:
//   1. Loads decoder_model_merged_q4f16.onnx with onnxruntime-node (native ORT)
//   2. Tokenizes prompts using the model's tokenizer.json
//   3. Greedy-decodes by feeding input_ids + attention_mask + position_ids
//      + 35 layers of past_key_values (zero-init on first step, then accumulated)
//   4. Records TTFT, tok/s, output text

import * as ort from "onnxruntime-node";
import { AutoTokenizer, env } from "@huggingface/transformers";
import { promises as fs } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODEL_DIR = resolve(__dirname, "../../models/runs/onnx-export-v2");
const DECODER_PATH = `${MODEL_DIR}/onnx/decoder_model_merged_q4f16.onnx`;
const TOKENIZER_PATH = `${MODEL_DIR}/tokenizer.json`;
const TOKENIZER_CONFIG_PATH = `${MODEL_DIR}/tokenizer_config.json`;
const CONFIG_PATH = `${MODEL_DIR}/config.json`;

// Gemma 4 chat template control tokens
const START_OF_TURN_USER = "<start_of_turn>user\n";
const END_OF_TURN = "<end_of_turn>\n";
const START_OF_TURN_MODEL = "<start_of_turn>model\n";

const PROMPTS = [
  "I'm feeling anxious right now. What's one small thing I can do in the next minute?",
  "Walk me through a 30-second breathing exercise. Keep it concrete.",
  "What is the capital of France? Answer in one sentence.",
  "Write a haiku about ocean waves.",
];

const MAX_NEW_TOKENS = 64;

interface Layer {
  headDim: number;
  numKVHeads: number;
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(path, "utf8"));
}

function makeKVTensor(
  numKVHeads: number,
  headDim: number,
  seqLen: number,
): ort.Tensor {
  // shape: [1, num_kv_heads, seq_len, head_dim], dtype: float16
  const total = numKVHeads * seqLen * headDim;
  return new ort.Tensor("float16", new Uint16Array(total), [
    1,
    numKVHeads,
    seqLen,
    headDim,
  ]);
}

function makeAttentionMask(totalSeq: number): ort.Tensor {
  const data = new BigInt64Array(totalSeq).fill(1n);
  return new ort.Tensor("int64", data, [1, totalSeq]);
}

function makePositionIds(start: number, length: number): ort.Tensor {
  const data = new BigInt64Array(length);
  for (let i = 0; i < length; i++) data[i] = BigInt(start + i);
  return new ort.Tensor("int64", data, [1, length]);
}

function makeInputIds(ids: number[]): ort.Tensor {
  return new ort.Tensor(
    "int64",
    new BigInt64Array(ids.map((n) => BigInt(n))),
    [1, ids.length],
  );
}

function argmax(arr: Float32Array | Float64Array | Uint16Array, vocab: number): number {
  // For fp16 logits we receive as Uint16Array of fp16 bit patterns. Convert to fp32 for argmax.
  // For benchmarking quality, we don't need decimal precision — just the index.
  let bestIdx = 0;
  let bestVal = -Infinity;
  const start = arr.length - vocab;
  for (let i = 0; i < vocab; i++) {
    const raw = arr[start + i];
    // If Uint16Array, interpret as fp16 bits and convert to fp32 magnitude (for argmax).
    let val: number;
    if (arr instanceof Uint16Array) {
      val = fp16BitsToFp32(raw);
    } else {
      val = raw as number;
    }
    if (val > bestVal) {
      bestVal = val;
      bestIdx = i;
    }
  }
  return bestIdx;
}

// IEEE 754 half-precision -> single-precision
function fp16BitsToFp32(h: number): number {
  const s = (h & 0x8000) >> 15;
  const e = (h & 0x7c00) >> 10;
  const f = h & 0x03ff;
  if (e === 0) {
    return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024);
  }
  if (e === 0x1f) {
    return f ? NaN : (s ? -1 : 1) * Infinity;
  }
  return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024);
}

async function main(): Promise<void> {
  console.log(`Loading config from ${CONFIG_PATH}`);
  const config = (await readJson(CONFIG_PATH)) as {
    text_config: { num_hidden_layers: number; head_dim: number; global_head_dim: number; num_key_value_heads: number; layer_types: string[]; vocab_size: number };
  };
  const tc = config.text_config;
  const numLayers = tc.num_hidden_layers;
  const numKVHeads = tc.num_key_value_heads;
  const layerTypes = tc.layer_types;
  const layers: Layer[] = layerTypes.map((t) => ({
    numKVHeads,
    headDim: t === "full_attention" ? tc.global_head_dim : tc.head_dim,
  }));
  const vocab = tc.vocab_size;
  console.log(`  ${numLayers} layers, vocab=${vocab}, kv_heads=${numKVHeads}`);
  console.log(`  layer 0 head_dim=${layers[0].headDim}, layer 4 head_dim=${layers[4].headDim}`);

  console.log(`\nLoading tokenizer from ${MODEL_DIR}`);
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.localModelPath = resolve(MODEL_DIR, "..");
  const tokenizer = await AutoTokenizer.from_pretrained("onnx-export-v2");
  console.log("  tokenizer ready");

  console.log(`\nLoading ONNX session from ${DECODER_PATH} (~2.6 GB, takes a moment)`);
  const t0 = performance.now();
  const session = await ort.InferenceSession.create(DECODER_PATH, {
    executionProviders: ["cpu"],
    graphOptimizationLevel: "all",
  });
  const loadMs = performance.now() - t0;
  console.log(`  loaded in ${(loadMs / 1000).toFixed(1)}s`);
  console.log(`  inputs: ${session.inputNames.length}, outputs: ${session.outputNames.length}`);

  for (const promptText of PROMPTS) {
    console.log(`\n=== ${promptText}`);

    // Use the tokenizer's bundled chat_template (Gemma 4 uses <|turn>role / <turn|> tokens,
    // NOT the Gemma 2/3 style <start_of_turn>...).
    const templated = tokenizer.apply_chat_template(
      [{ role: "user", content: promptText }],
      { tokenize: false, add_generation_prompt: true },
    ) as string;
    const encoded = await tokenizer(templated, { add_special_tokens: false });
    const inputIds = Array.from(encoded.input_ids.data as bigint[]).map(Number);
    console.log(`  prompt tokens: ${inputIds.length}`);

    // First (prefill) step
    let pastSeqLen = 0;
    let promptStart = performance.now();
    let firstTokenAt: number | null = null;

    // Build initial empty KV cache (zero-length seq for each layer)
    const buildFeeds = (
      ids: number[],
      pastKVs: ort.Tensor[],
      totalSeq: number,
      positionStart: number,
    ): Record<string, ort.Tensor> => {
      const feeds: Record<string, ort.Tensor> = {
        input_ids: makeInputIds(ids),
        attention_mask: makeAttentionMask(totalSeq),
        position_ids: makePositionIds(positionStart, ids.length),
      };
      for (let l = 0; l < numLayers; l++) {
        feeds[`past_key_values.${l}.key`] = pastKVs[l * 2];
        feeds[`past_key_values.${l}.value`] = pastKVs[l * 2 + 1];
      }
      return feeds;
    };

    // Initial KV: zero-length tensors
    let pastKVs: ort.Tensor[] = [];
    for (let l = 0; l < numLayers; l++) {
      pastKVs.push(makeKVTensor(numKVHeads, layers[l].headDim, 0));
      pastKVs.push(makeKVTensor(numKVHeads, layers[l].headDim, 0));
    }

    let curIds = inputIds;
    let totalSeq = inputIds.length;
    let positionStart = 0;
    const outputTokens: number[] = [];
    let stoppedEarly = false;

    for (let step = 0; step < MAX_NEW_TOKENS; step++) {
      const feeds = buildFeeds(curIds, pastKVs, totalSeq, positionStart);
      let outputs: ort.InferenceSession.OnnxValueMapType;
      try {
        outputs = await session.run(feeds);
      } catch (err) {
        console.log(`  step ${step} error: ${err instanceof Error ? err.message : String(err)}`);
        break;
      }

      if (firstTokenAt === null) firstTokenAt = performance.now();

      // logits shape: [1, seq, vocab]
      const logits = outputs.logits;
      const next = argmax(
        logits.data as Uint16Array | Float32Array,
        vocab,
      );
      outputTokens.push(next);

      // Stop on EOS-ish tokens (Gemma's <end_of_turn> is 107, <eos> is 1, eos_token_id from config is 106)
      if (next === 1 || next === 106 || next === 107) {
        stoppedEarly = true;
        break;
      }

      // Update KV cache from outputs (`present.<l>.key`, `present.<l>.value`)
      for (let l = 0; l < numLayers; l++) {
        pastKVs[l * 2] = outputs[`present.${l}.key`] as ort.Tensor;
        pastKVs[l * 2 + 1] = outputs[`present.${l}.value`] as ort.Tensor;
      }

      // Next step: single-token input
      positionStart += curIds.length;
      curIds = [next];
      totalSeq += 1;
    }

    const totalMs = performance.now() - promptStart;
    const ttftMs = firstTokenAt ? firstTokenAt - promptStart : 0;
    const decodeMs = totalMs - ttftMs;
    const tokensGenerated = outputTokens.length;
    const tps = decodeMs > 0 ? (tokensGenerated / decodeMs) * 1000 : 0;

    const decoded = await tokenizer.decode(outputTokens);
    console.log(`  TTFT ${ttftMs.toFixed(0)}ms | ${tokensGenerated} tok | ${tps.toFixed(1)} tok/s${stoppedEarly ? " (early-stop)" : ""}`);
    console.log(`  output: ${decoded.slice(0, 240).replace(/\n/g, " ")}${decoded.length > 240 ? "..." : ""}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
