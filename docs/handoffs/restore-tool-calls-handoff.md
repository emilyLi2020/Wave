# Handoff: Re-train the WAVE LoRA to restore native Gemma 4 tool emission

## Context (read this first)

The current production LoRA `Maelstrome/lora-wave-session-r32` (LoRA adapter on
`unsloth/gemma-4-E2B-it`) does NOT emit Gemma 4's native function-call tokens
(`<|tool_call>...<tool_call|>`). We confirmed this empirically:

- **Base `unsloth/gemma-4-E2B-it` + transformers**: emits clean
  `<|tool_call>call:endConversation{cravingScore:6,obstacleCategory:<|"|>none<|"|>}<tool_call|>`
  followed by a closing text turn. PASS.
- **Base + our LoRA via PEFT**: pure narration, zero tool tokens, even when
  the prompt explicitly asks for them. FAIL.

Reproduction script: [`models/finetune/test_tool_calling.py`](../../models/finetune/test_tool_calling.py)
(commands at top of file).

**Why the capability was lost:** the existing training set wraps assistant
turns in a JSON schema (`{"endConversation": null | {...}, "reply": "..."}`)
and **never** uses native tool tokens. The LoRA learned: "for this surface,
the right shape is JSON, never `<|tool_call>`." Over thousands of gradient
steps the tool-emission logits were suppressed to ~0 at the relevant token
positions.

**Goal of this run:** re-train with check-in assistant turns rewritten to
the native Gemma 4 tool-call format. Phase-narration and reflection stay
on the JSON-wrapper format (production code keeps `response_format:
json_schema` for those two surfaces and that path is verified working —
do **not** touch it). After the new LoRA is merged + converted + pushed,
the browser stack will switch the check-in path from `json_schema` to
streaming + native-tool-call parsing.

Read first (in this order):
1. [`models/finetune/README.md`](../../models/finetune/README.md) — full pipeline
2. [`models/README.md`](../../models/README.md) — env setup
3. [`models/finetune/test_tool_calling.py`](../../models/finetune/test_tool_calling.py) — proves base capability

You will need a Linux VM with a 16 GB+ NVIDIA GPU (CUDA 12.8). Same recipe
as the previous run: `cd models && uv sync && huggingface-cli login` per
`finetune/README.md` § Remote (Linux GPU VM).

---

## Part 1 — Data transformation

**Input:**  [`models/datasets/lora-wave-session-expanded.jsonl`](../../models/datasets/lora-wave-session-expanded.jsonl)
(4,277 rows: 1,534 check-in + 1,553 phase_narration + 1,190 reflection)

**Output:** `models/datasets/lora-wave-session-toolcall.jsonl` (new file,
same row count, only check-in rows transformed)

### Row structure today

Every row is JSONL with this shape:

```json
{
  "id": "...",
  "loraId": "lora-wave-session",
  "input": { "surface": "check_in" | "phase_narration" | "reflection", ... },
  "output": { "reply": "<text>", "endConversation": null | { "cravingScore": int, "obstacleCategory": "..." } },
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "{\"endConversation\":null,\"reply\":\"<text>\"}" }
  ],
  "splitKey": "...",
  "createdAt": "..."
}
```

The assistant message currently holds a JSON-stringified version of `output`.
The trainer feeds the model `messages` (not `input`/`output`).

### Transformation rules (apply per row)

**For phase_narration and reflection rows:** copy through unchanged.
The production code keeps `response_format: json_schema` for these and
the current LoRA already works for them (verified by the
`/models/wllama-schema-probe` probes 1 and 2).

**For check_in rows:** rewrite the assistant message content.

1. Parse the existing assistant content as JSON to recover `{reply, endConversation}`.
   (You can also read `row.output` directly — they're identical.)

2. **Intermediate check-in turns** (`endConversation` is `null`):
   New assistant content = the plain `reply` string, with no JSON wrapper
   and no tool tokens.

   Example transformation:
   ```
   BEFORE: {"endConversation":null,"reply":"Six is a little lower than where you started. Where did you notice the urge most during the last chunk?"}
   AFTER:  Six is a little lower than where you started. Where did you notice the urge most during the last chunk?
   ```

3. **Ending check-in turns** (`endConversation` is an object):
   New assistant content = native Gemma 4 tool call followed by the closing
   reply text.

   The exact format the base model emits (verified by
   `test_tool_calling.py`):
   ```
   <|tool_call>call:endConversation{cravingScore:<INT>,obstacleCategory:<|"|><ENUM><|"|>}<tool_call|><CLOSING TEXT>
   ```

   - `<|tool_call>` and `<tool_call|>` are single tokens; emit them as
     literal strings exactly as written.
   - `cravingScore` is bare int (no quotes).
   - `obstacleCategory` is wrapped in `<|"|>` quote tokens — these are
     literal Gemma 4 special-token characters, NOT `\"` escapes.
   - No space between `<tool_call|>` and the closing text.
   - The closing text is the existing `reply` string verbatim.

   Example transformation:
   ```
   BEFORE: {"endConversation":{"cravingScore":4,"obstacleCategory":"none"},"reply":"Alright. Let's move to the sound anchor together and see if it helps."}
   AFTER:  <|tool_call>call:endConversation{cravingScore:4,obstacleCategory:<|"|>none<|"|>}<tool_call|>Alright. Let's move to the sound anchor together and see if it helps.
   ```

4. **Update the row's `output` field too** (defensive, in case any eval
   path reads it): leave the structure as `{reply, endConversation}` —
   trainer code currently only renders `messages`, but downstream eval
   may consume `output`. Don't modify `input`, `splitKey`, `id`,
   `loraId`, `createdAt`.

### Acceptance checks for the transform script

Before running training, the transformer script should produce:

- Row count exactly matches input (4,277).
- For every check_in row where `output.endConversation` is an object, the
  new assistant content must:
  - Start with the literal string `<|tool_call>call:endConversation{`
  - Contain `<tool_call|>` exactly once
  - End with the original `reply` string
- For every check_in row where `output.endConversation` is null, the new
  assistant content must equal `output.reply` exactly (no JSON wrapper).
- For every phase_narration and reflection row, the assistant content is
  unchanged byte-for-byte.

Write a one-pager `models/finetune/transform_to_native_tools.py` (or
similar — match the existing script style in `models/finetune/`) that
runs the transform, prints a summary table (counts per surface,
ending-vs-intermediate split for check-in), and writes the new file.

---

## Part 2 — Training

### Hyperparameters (match the prior production run, one epoch this time)

The last production run is recorded at
[`models/runs/lora-wave-session/20260511T082918Z/run-config.json`](../../models/runs/lora-wave-session/20260511T082918Z/run-config.json).
It used the trainer's defaults except for `--epochs 3` (which derived
`totalSteps: 1284`).

**For this run, use one epoch.** All other knobs match the prior run.

Command (run from `models/` on the Linux VM):

```bash
uv run python finetune/train_wave_session_lora.py \
  --data datasets/lora-wave-session-toolcall.jsonl \
  --output-dir runs/lora-wave-session-toolcall \
  --model-id unsloth/gemma-4-E2B-it \
  --backend unsloth \
  --seed 7 \
  --epochs 1 \
  --batch-size 1 \
  --gradient-accumulation-steps 8 \
  --learning-rate 2e-4 \
  --weight-decay 0.001 \
  --max-grad-norm 0.3 \
  --lora-r 16 \
  --lora-alpha 32 \
  --lora-dropout 0.0 \
  --max-seq-length 3072 \
  --max-new-tokens 420 \
  --save-steps 50 \
  --save-total-limit 5 \
  --validation-size 0.10 \
  --test-size 0.10 \
  --validation-eval-mode completion \
  --final-eval-mode generation
```

**Note on `--final-eval-mode generation`:** Linux VM only. On Windows
this hits a CUDA illegal-memory bug on Gemma 4 + Unsloth and is unsafe
(see `finetune/README.md` § Pain Points & Footguns). On Linux it's the
mode that actually exercises tool emission during eval, so we want it.

Expected step count for one epoch: `ceil(3421 / 8) = 428` steps (~10-20
minutes on an A100, longer on a 16 GB consumer GPU).

### Dry-run first

Always:

```bash
uv run python finetune/train_wave_session_lora.py \
  --data datasets/lora-wave-session-toolcall.jsonl \
  --dry-run
```

The dry-run validates the dataset split + tokenization without loading
Gemma. Confirms no rows exceed `--max-seq-length` (3072) — the
`<|tool_call>` insertion will increase length on ending check-in rows by
~30 tokens, well under the ceiling, but verify the counts in the dry-run
output.

---

## Part 3 — Post-training verification (mandatory before push)

### 3a. Merge the adapter

```bash
uv run python finetune/merge_lora_peft.py \
  --base unsloth/gemma-4-E2B-it \
  --adapter runs/lora-wave-session-toolcall/<TIMESTAMP>/adapter \
  --out-dir runs/merge-toolcall \
  --device cuda \
  --dtype bfloat16
```

Use `merge_lora_peft.py`, **not** the unsloth merge — unsloth's merge
produces all-`<pad>` output on this base model
(`finetune/README.md` § Gotchas).

### 3b. Diagnose the merged base (mandatory smoke test)

```bash
uv run python finetune/diagnose_merged_base.py \
  --source-repo runs/merge-toolcall \
  --prompts "I'm feeling anxious right now. What's one small thing I can do?" \
            "What is the capital of France? Answer in one sentence." \
  --max-new-tokens 48 \
  --device cuda \
  --dtype bfloat16
```

If output is gibberish or all-`<pad>`, **stop**. The merge is broken.
Do not convert to GGUF. Do not push.

### 3c. Run the tool-emission probe against the merged base

Use the same script that diagnosed the original LoRA:

```bash
uv run python finetune/test_tool_calling.py \
  --source-repo runs/merge-toolcall
```

Required verdict: **PASS** — must report `Found N native Gemma 4 tool
token(s): ['<|tool_call>', '<tool_call|>']`.

If this still FAILs, the data transformation didn't take effect during
training. Common causes: the trainer is still rendering rows via the
JSON wrapper path (check `--prompt-style` / the dataset adapter), or
the `<|tool_call>` / `<tool_call|>` tokens aren't single tokens in the
tokenizer (run `tokenizer.tokenize("<|tool_call>")` to verify they're
length-1). Don't proceed to GGUF until this probe PASSes.

### 3d. Convert to GGUF

See `models/gguf/README.md` for the conversion + Q4_K_M quantize + 5-way
split (browser `ArrayBuffer` ceiling). Same recipe as the existing
GGUF.

### 3e. Push to HuggingFace

**Use a new repo name** so the existing working LoRA isn't blown away
until the new one is verified end-to-end in the browser:

- LoRA adapter → `Maelstrome/lora-wave-session-r32-toolcall`
- GGUF        → push split shards alongside (same repo, `gguf/`
  subfolder, mirroring the existing layout)

```bash
huggingface-cli upload Maelstrome/lora-wave-session-r32-toolcall \
  runs/lora-wave-session-toolcall/<TIMESTAMP>/adapter/

huggingface-cli upload Maelstrome/lora-wave-session-r32-toolcall \
  runs/merge-toolcall-gguf/ gguf/
```

### 3f. Report back

Once the HF push is done, report:

1. The HF repo URL.
2. The probe-passing tool-call output (paste the raw tokens 0..30 from
   `test_tool_calling.py --source-repo Maelstrome/lora-wave-session-r32-toolcall`).
3. The final-eval composite score from
   `runs/lora-wave-session-toolcall/<TIMESTAMP>/eval-summary.json`.
4. Any deviations from the spec above + why.

The browser stack swap (point `client/lib/wllama/config.ts`'s
`WAVE_GGUF_REPO` at the new repo + rewrite `generateWllamaCheckIn` to
stream + parse native tool calls) is a separate task that lives in the
client repo. Don't touch the client code in this handoff.

---

## What NOT to change

- Phase narration training rows.
- Reflection training rows.
- Trainer code (`train_wave_session_lora.py`) — defaults already match
  the prior production run.
- Merge script (`merge_lora_peft.py`).
- The existing `Maelstrome/lora-wave-session-r32` HF repo (leave it
  working until the new repo is verified browser-side).
- `models/datasets/lora-wave-session-expanded.jsonl` (the input — never
  modify in place; write a new file).
