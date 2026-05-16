# Tool-call LoRA fine-tune: three root causes, three more failed retries, structural problem identified

> **Status: blocked on external research, 2026-05-16.** Followed [`docs/handoffs/restore-tool-calls-handoff.md`](../handoffs/restore-tool-calls-handoff.md). Six training runs in total (v1 / v2 / v3 / v4 / v5 / v6). v1–v3 documented in §1–§5 below. v4/v5/v6 added in §6 — each used a different dataset structure following the recipe in §4 and each FAILED with the same mode-collapse signature. Base `unsloth/gemma-4-E2B-it` + matching prompt emits varied, contextually-correct tool calls 3-of-3 in token-level probing; the fine-tunes collapse to one canned response across all probed rows. Two deep-research prompts queued at [`docs/research/`](../research/) — one for fine-tune recipe gaps, one for iOS RN deployment. Open issue: [emilyLi2020/Wave#10](https://github.com/emilyLi2020/Wave/issues/10).

Forensic artifacts on Thunder VM instance `8v1bk872`:
- `runs/lora-wave-session-toolcall/` — v1 adapter (broken via `build_full_messages` bug)
- `runs/lora-wave-session-toolcall-v2/` — v2 adapter (broken via Unsloth template stripping `tools=`)
- `runs/lora-wave-session-toolcall-v3/` — v3 adapter + `validation-eval.json` (PPL 127.2)
- `runs/merge-toolcall-v3/` — bf16 PEFT-merged v3, smoke-tested with `diagnose_merged_base.py` (PASS)

| Run | Fix applied | Probe verdict |
|---|---|---|
| Base `unsloth/gemma-4-E2B-it` | (control, no LoRA) | **PASS** — emits `<\|tool_call>call:endConversation{cravingScore:6,obstacleCategory:<\|"\|>none<\|"\|>}<tool_call\|>Thank you...` |
| v1 | Rewrote check_in assistant content to native tool-call format per handoff spec | FAIL — emits JSON. Trainer ignored my `messages` and re-built assistant content from `output_payload`. |
| v2 | Patched `build_full_messages` to honor `example.messages[-1].content` | FAIL — same JSON. Unsloth's `gemma-4` chat template silently strips the `tools=` argument. |
| v3 | Preserved base tokenizer's chat template so `tools=` actually renders; threaded `tools=` through 4 render call sites for `check_in` rows | FAIL — but produces clean JSON ending output. Class imbalance + prompt's `<task>` block demanding JSON win. |

## 1. The three root causes we found and fixed

### 1.1 Trainer reconstructed assistant content from `output_payload`, ignoring my rewritten `messages`

[`models/finetune/train_wave_session_lora.py`](../../models/finetune/train_wave_session_lora.py) `build_full_messages` originally did:

```python
def build_full_messages(example: Example) -> list[dict[str, str]]:
    return [
        *build_prompt_messages(example),
        {"role": "assistant", "content": compact_json(example.output_payload)},
    ]
```

The handoff's transform script ([`transform_to_native_tools.py`](../../models/finetune/transform_to_native_tools.py)) rewrote `messages[-1].content` to the native tool-call string. But `build_full_messages` rebuilds the assistant message from `example.output_payload` via `compact_json(...)`, so the trainer **never saw my rewritten content**. v1 retrained on the same JSON wrapper for 90 minutes.

**Fix**: honor `example.messages[-1].content` when present, fall back to `compact_json` only if absent:

```python
def build_full_messages(example: Example) -> list[dict[str, str]]:
    assistant_content = compact_json(example.output_payload)
    if example.messages and example.messages[-1].get("role") == "assistant":
        explicit = example.messages[-1].get("content")
        if isinstance(explicit, str) and explicit:
            assistant_content = explicit
    return [
        *build_prompt_messages(example),
        {"role": "assistant", "content": assistant_content},
    ]
```

### 1.2 Unsloth's `gemma-4` chat template silently ignores `tools=`

`get_chat_template(tokenizer, chat_template="gemma-4")` from `unsloth.chat_templates` replaces the base tokenizer's chat template with a simplified Unsloth variant that has **no tool-rendering branch**. The base Gemma 4 template (used by `AutoProcessor` at inference) DOES render `tools=` into the system context as `<|tool>declaration:endConversation{...}<tool|>`. So during v1+v2 training the prompts never contained the tool declaration — only inference did, creating a train/test distribution mismatch.

Verified empirically with `check_templates.py`:

| Template | `apply_chat_template(..., tools=[TOOL])` length | `apply_chat_template(...)` length | Diff |
|---|---|---|---|
| Base `unsloth/gemma-4-E2B-it` | 364 chars | 89 chars | +275 chars of tool spec |
| Unsloth `get_chat_template(..., "gemma-4")` | 89 chars | 89 chars | **0 — tools= ignored** |

**Fix**: snapshot the base template before `get_chat_template` runs, restore it after. Render markers (`<|turn>user\n`, `<|turn>model\n`) survive intact so `train_on_responses_only` masking still works.

```python
def load_unsloth_model(args, FastModel, get_chat_template):
    model, tokenizer = FastModel.from_pretrained(...)
    base_template = tokenizer.chat_template
    tokenizer = get_chat_template(tokenizer, chat_template="gemma-4")
    if base_template:
        tokenizer.chat_template = base_template
    ...
```

After this fix, the v3 render gained the expected tool-spec preamble (+617 chars / +147 tokens vs no-tools render). Max sequence length 2227 → 2374, still well under the 3072 ceiling.

### 1.3 Class imbalance + user prompt's `<task>` block demands JSON

Even with the right rendering, v3 still emits narration or JSON because:

(a) **The user prompt explicitly tells the model to return JSON**, baked into every `check_in` row:

```xml
<task>
Write agent turn #N only.
Return strict JSON with exactly two top-level keys: reply and endConversation.
For intermediate turns, endConversation must be null.
For the final hand-off turn, endConversation must be an object:
{"action":"end","cravingScore":<integer 1-10>,"obstacleCategory":"<allowed obstacle or null>"}
No markdown, no extra commentary, no extra keys.
</task>
```

(b) **94% of training rows train against tool emission at the model-turn position.** Dataset class breakdown (4,277 rows):

| Surface | Rows | Should emit `<\|tool_call>` first? |
|---|---|---|
| `check_in` ending | 240 (5.6%) | **yes** |
| `check_in` intermediate | 1,294 (30.3%) | no |
| `phase_narration` | 1,553 (36.3%) | no |
| `reflection` | 1,190 (27.8%) | no |

Verified with `probe_rewritten_task.py`: even hand-rewriting the `<task>` block at inference time on v3 to ask for the tool call, the model still emits narration. So fixing (a) alone is insufficient.

## 2. The empirical destruction-of-capability finding

Earlier I described the LoRA's effect as "suppression, not deletion" and predicted that sampling at temperature > 0 would recover some `<|tool_call>` emissions. Ran [`probe_temperature.py`](../../probe_temperature.py) on the merged v3 against the standard probe context. **Predicted ~5–10% tool-call rate at T=0.8 / top_p=0.95. Observed 0/20.**

Top-30 next-token distribution at the model-turn boundary (v3 merged, native AutoProcessor + tools=):

```
Rank   Token              Probability
  1.   "Great"            0.826      ← argmax
  2.   "Let"              0.153
  3.   "That"             0.007
  4.   "Excellent"        0.005
  5.   "Wonderful"        0.005
  ...
  P(<|tool_call> id=48)   = 0.000005     ← 5 in a million
  P(<tool_call|> id=49)   = 0.000000
```

The LoRA drove $P(\langle|\text{tool\_call}\rangle)$ from base-Gemma's substantial mass (it's argmax in this exact context on the base model) down to $5{\times}10^{-6}$ — a **~100,000× suppression**, ~11.5 nats of logit shift. At top_p=0.95 the token is so far outside the nucleus that you'd never sample it without temperature ≈ 5+ or a logit_processor that suppresses every text token.

The 20-sample test is **massively underpowered** to detect residual probability at that scale, so "0/20" doesn't disprove non-zero — it just confirms the suppression is far past argmax-flipping into functional destruction.

### 2.1 Why so extreme — the math

For softmax + cross-entropy, the gradient w.r.t. logit $z_k$ is exactly:

$$\frac{\partial \mathcal{L}}{\partial z_k} = p_k - y_k$$

(`prediction - truth`, the log in CE cancels with the exp in softmax; see [Robot Chinwag walkthrough](https://robotchinwag.com/posts/crossentropy-loss-gradient/), confirmed by [Log Probability Tracking, arxiv 2512.03816](https://arxiv.org/html/2512.03816v1): "during training, except for the label class whose logit increases, all other tokens experience a logit decrease proportional to their probabilities").

At the model-turn position in an intermediate check_in row where the target is a text token:
- Token `<|tool_call>` has $y=0$, so its gradient is $\partial \mathcal{L} / \partial z_{tc} = p_{tc}$
- This pushes $z_{tc}$ **down** every step, proportional to its current probability

Negative gradient signal per epoch:
- 1,294 intermediate check_in rows × $p_{tc}$ per row
- 1,553 phase_narration + 1,190 reflection rows × tiny $p_{tc}$ per row (base model rarely fires tool tokens here, so contribution is smaller)
- All consistent direction

Positive gradient signal per epoch:
- 240 ending check_in rows × $(1 - p_{tc})$ per row

Net direction-consistent pressure ratio: ~5:1 in favor of suppression. With LoRA's free capacity (r=16, α=32, effective scaling 2.0 on a low-rank update of full attention+MLP), translating that consistent gradient pressure into ~11 nats of logit shift is well within the regime the [Log Probability Tracking paper](https://arxiv.org/html/2512.03816v1) characterizes — they describe **log probabilities being 2–3 orders of magnitude more sensitive than other detection methods** to even single-step fine-tuning changes. 5 orders of magnitude over 1,294 negative examples × LoRA's expressivity is on-spec.

### 2.2 Why this matches the "spurious tokens" literature

[Sekhsaria et al, "LoRA Users Beware" (arxiv 2506.11402)](https://arxiv.org/html/2506.11402v1) found that **even a single token of spurious correlation + a rank-1 LoRA** is enough to make a >1B-parameter model "fully disregard its pretraining knowledge." Our setup is well past their minimum conditions:

- Rank 16 (16× the demonstrated minimum)
- Multiple shortcut tokens in the prompt: `<surface>check_in`, the entire structured `<clinician_instructions>` block, the `<task>` block explicitly demanding JSON
- 1,294 consistent negative gradient steps at lr 2e-4

The mechanism their paper identifies (LoRA latches onto a high-signal shortcut token and uses it to override the pre-trained behavior) is exactly the failure mode we hit.

## 3. What v3 actually does work for

v3 LoRA emits:

- **Ending check_in turns**: `{"reply":"<closing>","endConversation":{"action":"end","cravingScore":<int>,"obstacleCategory":<str>}}` — valid, schema-compliant
- **Intermediate check_in turns**: `{"reply":"<question>","endConversation":null}` — valid
- **Phase narration / reflection**: same JSON wrapper, untouched from prior training
- Validation completion NLL 4.91 (PPL 127.2) on a 428-example split

If the goal is "ship a working LoRA today on the JSON path," v3 → `Maelstrome/lora-wave-session-r32-toolcall` on a new HF repo, browser keeps `response_format: json_schema`. Defers the streaming + native-tool-call browser switch the handoff anticipated.

## 4. Recipe for v4

The implication from §2 is that **cross-entropy gradient on the dominant class will keep crushing rare tokens regardless of how many positive examples you add**, unless something dampens the negative gradient signal at the `<|tool_call>` position. So v4 has to do more than "remove shortcuts + bump epochs":

1. **Strip the JSON instruction from the `<task>` block** in `check_in` rows. Replace with a tool-aware instruction. Without this, no amount of training will overcome the prompt-level shortcut.
2. **Use the structured `tool_calls` assistant message format**, not a raw `<|tool_call>...` string in `content`. Per the [Vertex AI Gemma 4 tool-calling recipe](https://huggingface.co/docs/google-cloud/examples/vertex-ai-notebooks-fine-tune-gemma-4):

   ```python
   {"role": "assistant",
    "tool_calls": [{"type": "function",
                    "function": {"name": "endConversation",
                                 "arguments": {"cravingScore": 7, "obstacleCategory": "mind_wandering"}}}],
    "content": "<closing reply>"}
   ```

   The chat template's structured-tool-calls render path is what base Gemma 4 was trained on. Shoving the raw token sequence into `content` makes it opaque to the template and the model never sees the structural cue.
3. **Counter the negative gradient signal** on `<|tool_call>` from the 1,294 intermediate check_in rows. Options in order of leverage:
   - **Focal loss** — down-weights confident-and-correct predictions, so once the model has learned "intermediate turn → text token" it stops getting hammered with the same gradient. Small code change in the trainer's collator.
   - **Token-level loss masking** — explicitly exclude `<|tool_call>` from negative gradient on intermediate turns. Hard to do in TRL without a custom collator. See [Selective Critical Token Fine-Tuning, arxiv 2510.10974](https://arxiv.org/html/2510.10974) for the formal treatment.
   - **Modest upweighting** of ending rows: 3× to make the positive gradient sum at this position roughly match the negative gradient sum. Easiest.
4. **Bump `--epochs` 1 → 3** and **drop `--learning-rate` 2e-4 → 2e-5**. The handoff's 2e-4 + 1-epoch matched what worked for JSON output, but the [FunctionGemma fine-tune guide](https://ai.google.dev/gemma/docs/functiongemma/finetuning-with-functiongemma) reports needing **8 epochs at lower LR to hit 80% tool-call accuracy** on a focused dataset.
5. **Verify rendering before training**: render an ending check_in row through the patched trainer's pipeline and confirm the assistant span starts with the `<|tool_call>` token (id 48). Don't trust that the trainer is doing the right thing — three previous runs proved otherwise.

Estimated cost: 3–4 hours of training on the existing Thunder A100, plus 5 min merge + 5 min probe. No new VM needed.

## 5. What we learned that survives the project

1. **Always render-check before launching a long training run.** All three failures were detectable in 30 seconds with `tokenizer.apply_chat_template` + a `print(text[-500:])`. Three 90-minute runs spent on broken pipelines.
2. **`tokenizer.apply_chat_template(messages, tools=TOOLS)` is the contract for tool-aware training.** The base tokenizer's template must support it. Unsloth's `get_chat_template` variants don't — by design or by oversight. Sanity-check by rendering with and without `tools=` and confirming the byte diff is non-zero.
3. **The trainer's `messages` field needs an explicit codepath.** Dataset hand-offs that include `messages` should either be honored in full or rejected loudly. A silent overwrite via `compact_json(output_payload)` cost a whole epoch.
4. **Cross-entropy on rare tokens is brutally effective at suppression.** A token at base P ≈ 0.5 in the relevant context can be driven to $5{\times}10^{-6}$ in a single LoRA epoch when 94% of the training distribution treats it as negative. The "LoRA forgets less than full SFT" intuition does not generalize to rare-token control circuits — those are exactly the kind of "critical directions" [OPLoRA (arxiv 2510.13003)](https://arxiv.org/html/2510.13003v2) warns get disrupted.

## Sources

- [`docs/handoffs/restore-tool-calls-handoff.md`](../handoffs/restore-tool-calls-handoff.md) — the spec
- [Fine-tune Gemma 4 with TRL on Vertex AI](https://huggingface.co/docs/google-cloud/examples/vertex-ai-notebooks-fine-tune-gemma-4) — the working recipe with structured `tool_calls` and full-LM SFT
- [Fine-tuning with FunctionGemma](https://ai.google.dev/gemma/docs/functiongemma/finetuning-with-functiongemma) — 8-epoch reference, balanced-dataset construction
- [Function calling with Gemma 4](https://ai.google.dev/gemma/docs/capabilities/text/function-calling-gemma4) — native token format reference
- [HuggingFace Chat Templating](https://huggingface.co/docs/transformers/main/en/chat_templating) — `tools=` semantics, template matching requirement
- [LoRA Users Beware (arxiv 2506.11402)](https://arxiv.org/html/2506.11402v1) — single-token-shortcut suppression at rank-1
- [Log Probability Tracking of LLM APIs (arxiv 2512.03816)](https://arxiv.org/html/2512.03816v1) — empirical sensitivity bounds, 2–3 OOM
- [LoRA Learns Less and Forgets Less (arxiv 2405.09673)](https://arxiv.org/html/2405.09673v2) — forgetting scales with parameters × steps
- [OPLoRA (arxiv 2510.13003)](https://arxiv.org/html/2510.13003v2) — LoRA disrupts critical weight directions
- [Selective Critical Token Fine-Tuning (arxiv 2510.10974)](https://arxiv.org/html/2510.10974) — token-level loss masking
- [Cross-Entropy Loss (Softmax) Gradient — Robot Chinwag](https://robotchinwag.com/posts/crossentropy-loss-gradient/) — gradient derivation
- [Unsloth Gemma 4 Fine-tuning Guide](https://unsloth.ai/docs/models/gemma-4/train) — response-only masking markers

## 6. v4 / v5 / v6 — three dataset structures, same mode collapse

After v3 we followed the §4 recipe and built v4 with structured `tool_calls` + task-block rewrite + 3× upweight + bumped epochs. v4 failed the same way. v5 added a system-prompt rewrite to drop the JSON instruction. Same failure. v6 reshaped to match base Gemma 4's *empirically observed* native emission shape (literal text, no special tokens) — and still failed. Each run uncovered a new finding without breaking the collapse.

### 6.1 v4 — multi-turn structured `tool_calls`

[`transform_to_native_tools_v4.py`](../../models/finetune/transform_to_native_tools_v4.py). Per the §4 recipe:

* Ending check_in turns split into five-message conversation: `[system, user, assistant(tool_calls=[...]), tool({"status":"acknowledged"}), assistant(reply)]`.
* `<task>` block rewritten to drop "Return strict JSON" and instruct on the tool call.
* Ending rows upweighted 3× (240 unique → 720 rows; positive class 5.6% → 15.1%).
* r=8, lora_alpha=16, lr=5e-5, epochs=3, batch=8 on B200 (per [`memory/project_lora_training_batch_size_lever.md`](../../memory/project_lora_training_batch_size_lever.md)).

**Verdict: FAIL.** Gate 4 probe (`test_tool_calling.py`) returns plain narration ("Let's bring our attention back…") with no `<|tool_call>` token. Gate 6 stability probe (10 ending rows) returns 0/10.

### 6.2 v5 — v4 + system-prompt rewrite

[`transform_to_native_tools_v5.py`](../../models/finetune/transform_to_native_tools_v5.py). Same structure as v4 plus:

* System prompt for check_in rewritten to remove `"Return only strict JSON matching the output schema requested in the user prompt"` and add `"call the endConversation tool. Do not output JSON."`
* Task verb changed `Otherwise just reply` → `Otherwise just respond` (so the model doesn't seed a `reply` JSON key).

**Verdict: FAIL.** Same collapse pattern. 0/10 on Gate 6.

### 6.3 The probe harness bug that masked v4/v5 diagnosis

While investigating v5, discovered that [`train_wave_session_lora.py`](../../models/finetune/train_wave_session_lora.py)'s `build_prompt_messages()` used `example.prompt` (the legacy source dataset field, which still contains the original `Return strict JSON` task block) and a hardcoded `WAVE_JSON_SYSTEM_PROMPT` constant — NOT the row's rewritten `example.messages[1]['content']`. Every probe (`test_tool_calling.py`, `test_tool_calling_stability.py`, `test_regression_phase_reflection.py`) was therefore testing with the OLD prompt format across v4 AND v5.

**Fix:** `build_prompt_messages` now prefers `example.messages[:2]` when present, falls back to hardcoded only for legacy rows. With the fix, base Gemma 4 + v5/v6 prompts (rendered via `apply_chat_template(..., tools=[endConversation])`) reliably emit the tool call. The fine-tuned LoRAs still collapse.

### 6.4 The empirical token-level discovery on base Gemma 4

[`probe_base_gemma_native.py`](../../models/finetune/probe_base_gemma_native.py) on three distinct ending check_in rows from the v5 dataset, base `unsloth/gemma-4-E2B-it` (no LoRA), bf16, `do_sample=False`:

```
Row 0: endConversation{cravingScore:7,obstacleCategory:mind_wandering}
       It sounds like that small shift was enough to move forward. I'm here with you as you continue.<turn|>
Row 1: endConversation{cravingScore:8,obstacleCategory:mind_wandering}
       It sounds like you're ready to move forward. We can now transition into the body scan.<turn|>
Row 2: endConversation{cravingScore:7,obstacleCategory:mind_wandering}
       It sounds like that social looping was a real drain. I'm glad that small shift felt enough...<turn|>
```

Token-level inspection: zero `<|tool_call>` (id 48), zero `<tool_call|>` (id 49), zero `<|"|>` (id 52). First token of the tool call is plain `'end'` (id 643). The model emits the tool call as **literal text** — the chat template injects the tool spec into the prompt using specials, but the model's response is plain text.

This invalidates §1's claim about base emission. The earlier "base PASSES" verdict in [`test_tool_calling.py`](../../models/finetune/test_tool_calling.py) was true on the `output_payload.endConversation` filter (since that filter selects rows where the dataset *target* contains the tool call), not on the model's actual emission shape. The model has never emitted `<|tool_call>` specials in our pipeline. The chat template is wrapper-only on the input side.

### 6.5 v6 — match base's natural emission shape

[`transform_to_native_tools_v6.py`](../../models/finetune/transform_to_native_tools_v6.py). Drops the multi-turn structure entirely. Ending check_in becomes a 3-message conversation with a single plain-text assistant target:

```python
{"role": "assistant",
 "content": f"endConversation{{cravingScore:{N},obstacleCategory:{CAT}}}\n{closing_speech}"}
```

No `tool_calls` field, no synthetic tool message, no `<|tool_call>` specials anywhere. Verified via [`inspect_v6_render.py`](../../models/finetune/inspect_v6_render.py) that this renders byte-for-byte identical to base Gemma 4's natural emission on the same prompts.

Trained with r=8, lr=5e-5, epochs=1, batch=8 on B200 (~11 min, ~$2). Final train loss plateau at 1.5–1.8.

**Verdict: FAIL.** Same mode collapse, different surface output. All 3 distinct ending rows produce the *identical* 9-token output: `Ready to continue into the body scan?<turn|>`. Zero variation by craving score, obstacle category, or dialogue context.

### 6.6 What the v6 mode-collapse output tells us

Original hypothesis: the LoRA was "parroting from prompt" because the clinician_instructions block in every check_in row's user prompt contains the literal string `Ready to continue into the body scan?` as the TURN 4 template question.

Empirical check ([`check_intermediate_v6.py`](../../models/finetune/check_intermediate_v6.py), [`check_ending_v6.py`](../../models/finetune/check_ending_v6.py)):

* `Ready to continue into the body scan?` appears in **0** intermediate targets, **0** ending targets (closing-speech portion), and **240** user prompts.
* Across the 240 unique ending rows the closing speech is one of only **5 distinct strings** (48× each). **4 of 5 start with `"Ready to continue with the next part…"`.**

So the LoRA's `Ready to continue into the body scan?` is a paraphrastic blend: `Ready to continue` prefix from the heavily-repeated training closing-speech vocabulary, `into the body scan` suffix from the clinician_instructions block in the user prompt. The model is generating tokens from the highest-density region of the conditional distribution induced by training, which combines (a) the dominant training-target start and (b) the dominant prompt-side phrase that thematically matches "Ready to continue".

### 6.7 Hypotheses surviving v6

1. **Class imbalance within the check_in surface.** 1,294 intermediate rows (no tool call) vs 720 ending rows (tool call). Ratio 1.8:1 favoring "no tool call." The LoRA learned "for check_in input, skip the tool call line entirely" as the dominant signal. §2's gradient-math story still applies, just with intermediate rows providing the negative signal at the tool-call position. Upweighting at 3× was insufficient to flip the ratio.
2. **Closing-speech vocabulary collapse.** Only 5 distinct closing speeches across 240 unique ending rows means the LoRA's target distribution at the closing-speech position is heavily peaked. Combined with hypothesis (1), the model converges on "skip tool call → emit highest-density closing-speech-shaped output," and the only way it can satisfy the loss across all rows is to produce a generic paraphrase rather than memorize any one variant.
3. **Recipe-equivalent attempts already exhausted.** v3 (r=32, lr=2e-4, epochs=1), v4 (r=8, lr=5e-5, epochs=3), v5 (same as v4 + system rewrite), v6 (r=8, lr=5e-5, epochs=1, plain-text target). Sweep candidates in `train_wave_session_lora.py:1070-1073` include `r8-a16-lr2e-4-e2`, `r16-a32-lr1e-4-e2`, `r16-a32-lr5e-5-e3`. Higher-rank / higher-LR retries have already been explored without breaking the collapse. The §4 plan as written is exhausted.

### 6.8 What's queued

Two deep-research prompts at [`docs/research/`](../research/):

* [`gemma4-fine-tune-research.txt`](../research/gemma4-fine-tune-research.txt) — questions for a research agent on: SOTA Gemma 4 E2B function-calling fine-tunes, FunctionGemma comparison, mode-collapse remedies, multi-task LoRA stability, train/inference template traps, and ranked alternative training strategies (DPO, prefix-tune, two-stage curriculum, etc.).
* [`gemma4-ios-rn-deploy-research.txt`](../research/gemma4-ios-rn-deploy-research.txt) — deployment questions for the iOS React Native target: runtime comparison (llama.rn, cactus, MediaPipe LLM Inference iOS), ANE viability, ~3GB GGUF download UX, App Store concerns. Independent of the training problem — runs in parallel.

B200 paused while research is in flight. v6 1-epoch adapter and merged checkpoint preserved at `/workspace/wave/models/runs/lora-wave-session-toolcall-v6-1ep/` and `/workspace/wave/models/runs/merge-toolcall-v6-1ep/`.
