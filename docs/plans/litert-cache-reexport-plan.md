# Plan — raise the stock LiteRT context ceiling for WAVE

> **✅ RESOLVED (2026-05-16) — re-export NOT needed.** Phase 0 ran on a
> physical iPhone 17 Pro. The whole WAVE session (5 phase narrations +
> reflection) runs on **stock Gemma 4 E2B LiteRT at eng2048/out256** once
> two demo corner-cuts shrink the input (phase narration → only the
> immediately-prior check-in; chunk system block trimmed ~half). 7/7
> probes passed, all valid JSON, no hangs/crashes, ~2.1 GB, ~3–4 tok/s.
> Raising the context ceiling / re-exporting is unnecessary — the binding
> issue was input size (fixed by the corner-cuts) and latency, not the
> compiled budget. Full results + shipping config:
> `docs/runbooks/stock-litert-working-config.md`; resolution in Wave#15.
> The phased re-export plan below is retained for the record only.

> Investigation plan for running WAVE's longer surfaces (chunks 2–5,
> >256-token outputs) on stock Gemma 4 LiteRT. Companion to
> `docs/postmortems/gemma4-litert-stock-limits-research.md`, the runbook
> `docs/runbooks/stock-litert-working-config.md`, and the new tracking
> issue. **Supersedes the earlier "2048 is a hard compiled cap" framing —
> see Correction below.**

## ⚠️ Correction: 2048 is NOT a hard compiled limit

The postmortem concluded the stock bundle was hard-capped at 2048
total / 256 decode. **That conclusion was confounded** by the old
wrapper's `maxTokens` conflation: every failure above 256 in that test
matrix was the conflated value hitting `session.max_output_tokens`
(decode chunk > compiled 256) — the engine `max_num_tokens` (the context
cache) at 2048 or 8192 was *never independently shown to be the wall*.

Three independent sources confirm context is **runtime-settable, not
bundle-fixed**:

- **HF model card**: the bundle "can support up to 32k context length";
  2048 is explicitly the *benchmark* config (1024 prefill / 256 decode /
  2048 ctx), not a ceiling.
- **[LiteRT #6765](https://github.com/google-ai-edge/LiteRT/issues/6765)**
  (2026-04-07, open): the official Gemma 4 `.litertlm`'s `LlmMetadata`
  **does not set `max_num_tokens`**; it is set at runtime. Results: 4096
  "stable — but only prompts up to ~700 tokens worked reliably", 8192 →
  nil, 16384 → SIGSEGV in `reshape::Eval`. **Caveats that matter:** this
  was **E4B**, **CPU/XNNPACK** (GPU was blocked), **iPhone 16 Pro Max** —
  i.e. a different model, backend, and device than WAVE's E2B/GPU/iPhone
  17 Pro. It proves context is runtime-settable and justifies a sweep; it
  does **not** predict our envelope (and even there, 4096 only worked for
  ~700-tok prompts).
- **[LiteRT-LM #2202](https://github.com/google-ai-edge/LiteRT-LM/issues/2202)**
  (field report): ran Gemma 4 **E2B** at `maxNumTokens=8192` on Android
  (Mali-G715) — it executed (hung only when a prompt actually approached
  8192), proving the engine accepts >2048 without re-export.

**So the genuine limit is platform-runtime, ~4096 on iOS arm64**, not a
2048 number baked into the bundle. The 256-decode cap is *also*
under-verified (same conflation confound) and must be re-measured with the
fork's split knobs.

## Goal

Establish, empirically and cheaply, the **real** usable
`engineMaxTokens` / `outputMaxTokens` envelope of the **existing** stock
bundle on iPhone 17 Pro via our fork — *before* spending any effort on a
re-export. Re-export is now the *fallback*, not the plan.

## Prior art — mistakes to not repeat (from #2202, #6765)

- **iOS hard ceiling ~4096.** Never set `engineMaxTokens` > 4096 on iOS
  (>4096 → nil/SIGSEGV, #6765). Plan around 4096 max.
- **Multi-turn KV-cache rebuild is lossy.** #2202 finding #5: a cache
  rebuilt from `initialMessages` (history replay) is *not* bit-equivalent
  to one grown turn-by-turn → coherence degrades after session rebuilds
  (cites ~39% single→multi-turn drop in the literature). **Directly hits
  WAVE**: our check-ins are multi-turn and chunk prompts replay history.
  Prefer growing one session over `reopenWithHistory()` where possible;
  budget for some quality loss on long sessions regardless of context size.
- **Hangs near the cap.** #2202 finding #4: prompts approaching
  `maxNumTokens` hang with no error (600s latch). Keep real prompts well
  under the configured cap; don't set the cap exactly at the expected max.
- **No per-turn budget override.** One conversation-wide cap; tool-call /
  long turns can't get a bigger transient budget. Size for the worst case.
- **E2B runtime memory ≈ 2.86 GB** (Mali-G715: 2.18 GB GPU + 0.68 GB CPU)
  vs ~2.5 GB on disk — at the *benchmark* context. Larger context grows KV
  cache on top; measure headroom under the iPhone jetsam limit (the
  `increased-memory-limit` entitlement is already set).

## Phase 0 — Runtime sweep on the EXISTING bundle (no re-export) ★ do this first

Our fork already separates `engineMaxTokens` from `outputMaxTokens`. Just
turn the knobs up on the bundle we already verified.

1. Add a dev test screen / params to sweep on iPhone 17 Pro, stock
   `gemma-4-E2B-it.litertlm`, fork `f9dbf28`:
   - `engineMaxTokens` ∈ {2048, 3072, 4096} (never >4096 on iOS)
   - `outputMaxTokens` ∈ {256, 384, 512} (re-test the "256 decode" wall —
     it may also have been a conflation artifact)
   - **`backend` recorded per row:** primary sweep on `gpu` (WAVE's real
     path); add a small `cpu` sanity row at one mid cell — upstream
     behaviour differs sharply by backend (#6765 was CPU-only), so a
     gpu-only result must not be generalised.
   - **Timeout / recovery rule (decide BEFORE running, per #2202 silent
     hangs):** per-cell hard timeout (e.g. 90 s wall with zero tokens, or
     >2× the expected decode time); on trip → log the cell as `HANG`,
     destroy + recreate the conversation/engine, and DO NOT keep sending
     on the wedged conversation. Treat a hang as a distinct outcome from
     truncation or error, not a pass.
   - **Real WAVE surfaces, not just synthetic sizes:** actual chunk 1–5
     prompts built with real session history, plus reflection and a
     multi-turn check-in flow — AND synthetic boundary sizes
     {700, 1400, 1846, 2400, 3200} to map the cliff.
   - Each surface run **both** with canonical `WAVE_SYSTEM_PROMPT` and
     `WAVE_SYSTEM_PROMPT_STOCK_COMPACT` (explicit A/B).
2. Per cell record: exact **tokenizer** input count (not chars/4); loads?
   generates coherent (not `<pad>`/garbage)? **output truncated / JSON
   schema-valid?** RAM (wrapper memory tracking) vs jetsam headroom;
   decode tok/s; TTFT; and the #2202 **hang-near-cap** behavior (does it
   silently latch?).
- **Gate 0:** find the largest stable `(engineMaxTokens, outputMaxTokens,
  inputLen)` envelope. If it covers WAVE chunks 2–5 (~2500–2900 input
  with history) + reflection within memory → **done, no re-export, no
  compact prompt strictly needed.** If iOS caps ~4096 and chunk-5 history
  still overflows → proceed to Phase 0b.

## Phase 0b — Add the compact system prompt (additive headroom)

Stack `WAVE_SYSTEM_PROMPT_STOCK_COMPACT` (~450–510 tok vs canonical
~900–1000) on top of the Phase 0 envelope. Cuts ~400–500 tok off every
chunk input → chunk-1 ~1846→~1400, and brings chunk-5 history under a
4096 engine cap. Re-run the relevant Phase 0 cells.
- **Gate 0b:** 4096 engine + compact prompt covers chunks 2–5 + reflection
  on device → ship that as the stock-LiteRT config; **re-export not
  needed.** Update the runbook.

## Phase 1 — Re-export at cache_length=4096 (FALLBACK, only if 0/0b fail)

Only if the existing bundle's runtime ceiling (~4096 iOS) still can't fit
the needed envelope, or `outputMaxTokens` is genuinely hard-capped at 256
and a surface needs more.

1. `pip install litert-torch` (record version + the `0.10.0 @44d606e`
   commit as a fallback); export **stock** `google/gemma-4-E2B-it` (NOT a
   LoRA) with `--cache_length=4096 --prefill_lengths=[512,1024]
   --externalize_embedder
   --jinja_chat_template_override=litert-community/gemma-4-E2B-it-litert-lm`.
2. Offline-inspect: `LlmMetadata.model_type == gemma4` or `generic_model`
   (the [#1005](https://github.com/google-ai-edge/litert-torch/issues/1005)
   TODO tell); section schema vs the working stock 2048 bundle.
- **Gate A:** `generic_model` / schema skew → won't load on the pristine
  `0.3.6` fork (= parked `Wave#12/#13` wall). Stop → Phase 2 fallback.
- Else load on the fork (iPhone), check coherence (not `<pad>`, cf
  [#994](https://github.com/google-ai-edge/litert-torch/issues/994)), then
  re-run the Phase 0 sweep on the new bundle.

## Phase 2 — Hybrid fallback (if LiteRT can't reach the envelope)

Stock LiteRT (compact prompt, Phase 0 envelope) for the prize demo +
reflection / check-in / early chunks; **llama.rn + GGUF** for full phase
generation — context set at load time, no compile/runtime ceiling of this
kind. This is the postmortem's standing recommendation; GGUF shards
already exist at `Maelstrome/lora-wave-session-r32/gguf/`.

## Decision matrix

| Finding | Action |
|---|---|
| Phase 0: existing bundle stable at engineMaxTokens 4096 covering chunks 2–5 | **Best case — no re-export, no new artifact.** Update runbook, close the issue. |
| Phase 0b: needs compact prompt + 4096 to fit | Ship compact prompt as the stock-path default; no re-export. |
| iOS ~4096 + compact still can't fit chunk-5, or output hard-capped 256 | Phase 1 re-export attempt (time-boxed ½ day) |
| Re-export `generic_model` / won't load / `<pad>` | Phase 2 hybrid (llama.rn/GGUF for phase gen) |

## Honest expectation

The corrected evidence makes Phase 0 **worth running first and plausibly
sufficient** — but it is *not a guarantee*. #6765 (E4B/CPU/iPhone 16 Pro
Max, ~700-tok cap at 4096) and #2202 (E2B/Android/GPU) establish that the
engine accepts >2048 at runtime; they do **not** prove WAVE's
E2B/iOS/GPU/long-history envelope works. Phase 0 is a measurement, not a
foregone conclusion — its purpose is to find the real cliff, including the
possibility that the iOS/GPU E2B ceiling is well under 4096 or that
quality degrades (multi-turn KV rebuild, #2202 finding #5) before the
token limit bites. Re-export remains a fallback that mostly re-treads the
parked #12/#13 converter wall. Net effort if Phase 0 wins: ~1–2 h of
on-device sweeping. Treat Phase 1 as a strictly time-boxed last resort.

## Sources

- [litert-community/gemma-4-E2B-it-litert-lm](https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm) (HF card: "up to 32k"; 2048 = benchmark)
- [LiteRT #6765 — max_num_tokens runtime-set; 4096 ok, >4096 SIGSEGV iOS](https://github.com/google-ai-edge/LiteRT/issues/6765)
- [LiteRT-LM #2202 — Gemma 4 E2B field report (8192 on Android, KV-rebuild loss)](https://github.com/google-ai-edge/LiteRT-LM/issues/2202)
- [Gemma 4 — Google AI Edge / LiteRT-LM](https://ai.google.dev/edge/litert-lm/models/gemma-4)
- [litert-torch #994 — Gemma export emits only pad tokens](https://github.com/google-ai-edge/litert-torch/issues/994)
- [litert-torch #998 — convert Gemma-4 safetensors to LiteRT-LM](https://github.com/google-ai-edge/litert-torch/issues/998)
- [litert-torch #1005 — gemma4 metadata builder TODO](https://github.com/google-ai-edge/litert-torch/issues/1005)
- [litert-torch #729 — KV-cached LLMs memory cost](https://github.com/google-ai-edge/litert-torch/issues/729)
