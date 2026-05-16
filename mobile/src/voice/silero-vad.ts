// Silero VAD v5 wrapper around onnxruntime-react-native.
//
// The model is downloaded at runtime through the unified model-cache (id
// `silero-vad`). The wrapper takes a local file path so it stays oblivious
// to where the file came from — call sites do `ensureModel('silero-vad')`
// first, then `createSileroVad(localPath)`.
//
// IMPORTANT: Silero v5's `input` tensor is NOT just a 512-sample chunk. The
// model expects [context_64 || chunk_512] = shape [1, 576] at 16 kHz, where
// the leading 64 samples are the trailing 64 samples of the previous chunk
// (zeros on the first call). Without this prepend the model emits ~0.001
// probabilities on everything — silence and speech alike — and the symptom
// is "VAD never fires." The official Python wrapper does this in
// utils_vad.py's OnnxWrapper.__call__. We mirror it here.
//
// Tensor I/O:
//   input  float32 [1, 576]     — context (64) + audio chunk (512)
//   state  float32 [2, 1, 128]  — LSTM hidden state (zeros at session start)
//   sr     int64   []           — sample rate scalar (16000)
//   ↓
//   output float32 [1, 1]       — speech probability
//   stateN float32 [2, 1, 128]  — updated state

import { InferenceSession, Tensor } from "onnxruntime-react-native";

export const VAD_SAMPLE_RATE = 16_000;
export const VAD_FRAME_SAMPLES = 512;
const CONTEXT_SAMPLES = 64;
const INPUT_SAMPLES = CONTEXT_SAMPLES + VAD_FRAME_SAMPLES; // 576 at 16 kHz
const STATE_LENGTH = 2 * 1 * 128;

export interface SileroVadFrameResult {
  /** Speech probability in [0, 1]. */
  probability: number;
}

export interface SileroVadIoSpec {
  name: string;
  type: string;
  shape: ReadonlyArray<number | string>;
}

export interface SileroVad {
  /** Run one 512-sample frame through the model and update internal state. */
  processFrame(frame: Float32Array): Promise<SileroVadFrameResult>;
  /** Zero the recurrent state. Call between independent utterances. */
  reset(): void;
  /** Release the native session. */
  release(): Promise<void>;
  /** Model input metadata — name/type/shape per input. Useful for debugging. */
  readonly inputs: ReadonlyArray<SileroVadIoSpec>;
  /** Model output metadata — same shape as inputs. */
  readonly outputs: ReadonlyArray<SileroVadIoSpec>;
}

export async function createSileroVad(modelPath: string): Promise<SileroVad> {
  // ORT expects a plain filesystem path on iOS. expo-file-system returns
  // paths with the file:// scheme; strip it for the binding.
  const cleanPath = modelPath.startsWith("file://")
    ? modelPath.slice("file://".length)
    : modelPath;

  const session = await InferenceSession.create(cleanPath);

  // Sanity-check the model: input/state/sr names and shapes can drift between
  // Silero releases (v4 used different names + state shape). Catch a mismatch
  // up front rather than at first inference where the error is opaque.
  const inputNames = new Set(session.inputNames);
  for (const required of ["input", "state", "sr"]) {
    if (!inputNames.has(required)) {
      throw new Error(
        `Silero VAD model missing input "${required}" (got: ${session.inputNames.join(", ")})`,
      );
    }
  }

  // ArrayBufferLike, not ArrayBuffer, because Tensor.data has a generic
  // backing buffer type that we re-assign back into here each frame.
  let state: Float32Array<ArrayBufferLike> = new Float32Array(STATE_LENGTH);
  // Rolling 64-sample context — trailing samples of the previous chunk.
  // Zeros on the first call.
  let context = new Float32Array(CONTEXT_SAMPLES);

  // Silero v5 declares `sr` as an int64 SCALAR (empty shape), not [1]. The
  // model graph contains an `If(Equal(sr, 16000))` branch that routes 16 kHz
  // audio through a different sub-network than 8 kHz. If sr doesn't arrive as
  // the literal int64 16000, the model runs the 8 kHz branch on 16 kHz audio
  // and outputs near-zero probabilities forever — exactly the "0.000 → 0.002"
  // symptom.
  //
  // Hermes' BigInt64Array support has had marshaling bugs where the underlying
  // 8-byte buffer doesn't actually hold the int64 representation the native
  // side expects. Build the bytes manually via DataView and wrap them with a
  // BigInt64Array view so the TypedArray type-check on the native side still
  // passes, but the buffer contents are guaranteed correct.
  const srBuffer = new ArrayBuffer(8);
  new DataView(srBuffer).setBigInt64(0, BigInt(VAD_SAMPLE_RATE), true);
  const srData = new BigInt64Array(srBuffer);
  const srTensor = new Tensor("int64", srData, []);

  const toSpec = (m: { name: string; isTensor: boolean; type?: string; shape?: ReadonlyArray<number | string> }): SileroVadIoSpec => ({
    name: m.name,
    type: m.isTensor ? (m.type ?? "?") : "non-tensor",
    shape: m.isTensor ? (m.shape ?? []) : [],
  });
  const inputs = session.inputMetadata.map(toSpec);
  const outputs = session.outputMetadata.map(toSpec);

  const processFrame = async (
    frame: Float32Array,
  ): Promise<SileroVadFrameResult> => {
    if (frame.length !== VAD_FRAME_SAMPLES) {
      throw new Error(
        `Silero VAD frame must be exactly ${VAD_FRAME_SAMPLES} samples; got ${frame.length}`,
      );
    }
    // Build [context_64 || frame_512] of length 576. Without this prepend
    // the model emits ~0.001 on everything (silence + speech alike).
    const framed = new Float32Array(INPUT_SAMPLES);
    framed.set(context, 0);
    framed.set(frame, CONTEXT_SAMPLES);

    const inputTensor = new Tensor("float32", framed, [1, INPUT_SAMPLES]);
    const stateTensor = new Tensor("float32", state, [2, 1, 128]);
    const feeds = { input: inputTensor, state: stateTensor, sr: srTensor };
    const results = await session.run(feeds);
    const probTensor = results.output;
    const newStateTensor = results.stateN;
    if (!probTensor || !newStateTensor) {
      throw new Error(
        `Silero VAD missing expected outputs (got: ${Object.keys(results).join(", ")})`,
      );
    }
    state = newStateTensor.data as Float32Array;
    // Carry the trailing 64 samples of this chunk forward as next chunk's
    // context. .slice() forces a copy so the next frame's framed-buffer
    // assignment can't overwrite the value we just stashed.
    context = frame.slice(VAD_FRAME_SAMPLES - CONTEXT_SAMPLES);
    const prob = (probTensor.data as Float32Array)[0] ?? 0;
    return { probability: prob };
  };

  const reset = () => {
    state = new Float32Array(STATE_LENGTH) as Float32Array<ArrayBufferLike>;
    context = new Float32Array(CONTEXT_SAMPLES);
  };

  const release = async () => {
    await session.release();
  };

  return { processFrame, reset, release, inputs, outputs };
}
