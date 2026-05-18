# GitHub Closed-Issues Digest — `emilyLi2020/Wave`

Repo `emilyLi2020/Wave`: **8 closed issues**, all substantive engineering tickets (none bot/automated/trivial; 0 skipped). Every issue is authored by a human collaborator and carries detailed problem statements, reproductions, neutral-observer review passes, and explicit RESOLVED/dead-end outcomes. Issue numbers 6–25 are non-contiguous because the gaps are pull requests and still-open issues (e.g. #17, #25 open). This digest is grouped by theme; each entry distills problem → fix → engineering lesson and a `Value:` tag.

---

## Browser runtime — ONNX / transformers.js / WebGPU

### #6 ONNX export needs `inputs_embeds` graph signature for transformers.js v4 — handoff for Windows machine
- **Problem:** A working q4f16 ONNX fine-tune (3.2 GB, coherent at 33–36 tok/s via `onnxruntime-node`) could not be driven by `@huggingface/transformers` v4 in the browser. transformers.js's Gemma 4 routing expects upstream's 2-graph layout (`embed_tokens.onnx` → `inputs_embeds` → decoder, 15 KV pairs with sharing); the hand-rolled `torch.onnx.export` produced a single graph taking `input_ids` + 35 KV pairs → `"Missing the following inputs: input_ids."`.
- **Fix done:** Re-exported on a 96 GB Windows box: `MergedDecoderWrapper.forward` rewritten to take `(inputs_embeds, per_layer_inputs, attention_mask, position_ids, past_kv)`, emit only 15 KV pairs (Gemma 4 E2B `num_hidden_layers − num_kv_shared_layers`); embed graph emits `inputs_embeds` + `per_layer_inputs`. v3 (2.8 GB) loads cleanly in transformers.js v4 and benches coherent on all 4 prompts.
- **Then blocked deeper:** Browser WebGPU still emitted `len=0` while Node CPU produced correct output with the same file. Root cause progressively sharpened: first blamed on `GatherBlockQuantized` int4 divergence, then *corrected* — embed_tokens is byte-identical to upstream; the real defect is the **decomposed** `torch.onnx.export` graph (`Pow(x,3)` in gelu-tanh, `Pow(x,2)` in RMSNorm). On WebGPU `Pow` is `exp(y·ln(x))` which NaNs for negative x → NaN cascade → first-token logits NaN → argmax hits stop token → empty output. Mitigation: `optimize_model(model_type="gpt2")` fuses 70 Tanh→FastGelu (2× faster, still coherent); v4-fused candidate staged, RMSNorm `Pow(x,2)`→`Mul(x,x)` flagged as next step.
- **Lessons:** (1) hand-rolled ONNX exports must match the consumer library's exact graph signature, not just produce numerically-correct output; (2) Node CPU ≠ browser WebGPU — same file, same lib, same template can diverge purely on kernel arithmetic (`Pow` of negatives); (3) decomposed-primitive graphs are a WebGPU liability vs fused contrib ops. Side findings: transformers.js#1666 `num_logits_to_keep=0` perf bug (200–500× extra lm_head work, ~6 tok/s on RTX 5080), Windows `cp1252` stdout crash on the export's `✅`, transformers.js v4 ignores `chat_template.jinja` (needs inlining into `tokenizer_config.json`).
- **Value:** postmortem-evidence
- https://github.com/emilyLi2020/Wave/issues/6

### #7 MLC web-llm path: working in-browser fine-tune blocked by state-leakage bug — parked, documented
- **Problem:** The MLC/web-llm path gives a smaller WebGPU-native bundle (2.5 GB q4f16_1 vs 3.2 GB ONNX) via PR #3485's Gemma-4-aware PLE table packing, and all three Gemma 4 variants produce coherent prompt-1 output after patches. Not shippable due to a confirmed `web-llm` cross-call state-leakage bug requiring an engine-reload workaround.
- **Fix/decisions done:** Source-built the full MLC toolchain on Mac (relax `ac9cf7aac` + mlc-llm `fa7cf711`), end-to-end convert/compile pipeline documented; required patches (Gemma 4 uses `<|turn>`/`<turn|>` tokens 105/106 — *not* Gemma 3's `<start_of_turn>` — so `gemma3_instruction` template is wrong; custom `gemma4_turn` conv_template; Next.js `/resolve/main/` rewrite). Parked, not shipped.
- **Deeper blocker found:** Trying to root-cause the browser garbage output, the Mac MLCEngine **hard-crashes on first prefill**: `batch_prefill_ragged_kv_kernel` needs 40.6 KB threadgroup memory but Apple Silicon caps Metal at 32 KB → pipeline-state creation refused. The browser path does *not* crash with this — it emits degenerate `'1. **feel** your **feet** **now**.'` text. **The browser is hiding a hard Metal failure as garbage output.** Python MLC-vs-ONNX benchmark therefore cannot run on Mac; viable on Windows/CUDA (96–228 KB shared mem).
- **Lessons:** (1) a "working in-browser" path can be masking a hard kernel failure that only surfaces in native tooling — validate in Python/native before trusting browser output; (2) Apple Silicon's 32 KB Metal threadgroup ceiling is a real constraint for generated attention kernels; (3) keep the build environment (`.bc`/`.dylib` artifacts) transferable — re-doing the LLVM/emscripten build on Windows is ~half a day.
- **Value:** postmortem-evidence
- https://github.com/emilyLi2020/Wave/issues/7

---

## Fine-tune conversion — MediaPipe / LiteRT bundle format

### #8 Convert PEFT-merged Gemma 4 fine-tune to MediaPipe `.task` on Mac (Windows can't, no litert-converter wheel)
- **Problem:** Ship the fine-tune in-browser via `@mediapipe/tasks-genai`, needing a MediaPipe `.task` bundle. `litert-converter` has no Windows wheel (only `manylinux_2_27_x86_64` / `macosx_12_0_arm64`) — conversion must happen on Apple Silicon or Linux. Includes a non-skippable guard: the original Unsloth-merged checkpoint was corrupt (100% `<pad>`); a PEFT re-merge replaces it, must be smoke-tested before sinking time.
- **Fix done → dead end:** Conversion ran cleanly on M-series Mac (10:16 wall-clock, `dynamic_wi8_afp32` ~4× embedder compression). **But the tooling only emits `.litertlm` (`LITERTLM` magic), never `.task` (`TFL3` magic)** for Gemma 4 — the legacy `.task` packager doesn't exist for this model in current `litert-torch-nightly`. **No version of `@mediapipe/tasks-genai` registers a `LITERTLM` matcher** (`"No model format matched."`). Hardlinking extension doesn't help (loader inspects bytes). Closed as a dead end with postmortem.
- **Lessons:** (1) two Google runtimes (MediaPipe LLM Inference vs LiteRT-LM) share the `.litertlm`/`.task` naming and `LITERTLM` magic but are NOT interchangeable — verify the converter↔consumer pair is public *and* the internal layout matches, not just the magic bytes; (2) Google staff publicly confirmed there is no fine-tuning→`-web.task` recipe ("probably won't be able to make any time soon"); 6+ developers stacked on the same wall upstream. Corroborates the existing `feedback_verify_vendor_pair_public` / `project_mediapipe_finetune_dead_end` memory.
- **Value:** postmortem-evidence
- https://github.com/emilyLi2020/Wave/issues/8

### #11 Re-export WAVE fine-tune to LiteRT-LM bundle format (replaces MediaPipe Model Maker output)
- **Problem:** The mobile pivot lands on `react-native-litert-lm` (wraps LiteRT-LM, a different runtime than MediaPipe Model Maker). The existing 5.07 GB MediaPipe-flavored `model.litertlm` is rejected on-device by `litert_lm_engine_create()` despite identical `LITERTLM` magic — internal layout mismatch. Stock `litert-community/gemma-4-E2B-it.litertlm` is 2.59 GB (~½, because LiteRT-LM mmaps embedding params separately).
- **Fix done:** Empirically confirmed the format-mismatch hypothesis on a physical iPhone — the unmodified stock 2.59 GB bundle loads and runs through the *exact same wrapper code path* that rejects the 5.07 GB MediaPipe bundle. This rules out wrapper/device/Metal/entitlement causes and isolates the defect to bundle flavor. Path forward: re-export via `litert-torch` Generative API on Linux x86_64.
- **Lessons:** Same-magic-bytes ≠ same-format at the engine level; a controlled A/B (stock vs ours through one code path) is the cleanest way to isolate a format vs environment defect. Reinforces the verify-vendor-pair memory at the *internal-format* level.
- **Value:** architecture-decision
- https://github.com/emilyLi2020/Wave/issues/11

---

## Mobile LiteRT — wrapper fork, context envelope, GPU

### #14 Fork react-native-litert-lm and unconflate maxTokens for long-prompt LiteRT support
- **Problem:** `react-native-litert-lm@0.3.6`'s `cpp/HybridLiteRTLM.cpp` applies one `maxTokens_` value to *both* the engine-wide KV cache (`set_max_num_tokens`) and the per-call decode cap (`set_max_output_tokens`). No single value can simultaneously hold the ~1846-token WAVE prompt AND keep the decode chunk within the bundle's compiled graph — the full prompt cannot run.
- **Fix done:** Forked to `IdkwhatImD0ing/react-native-litert-lm-wave@f9dbf28` (pristine `0.3.6` + a 5-file patch; an earlier framework-bundling attempt `d35ba92` was abandoned because the rebuilt `main` C header broke the `0.3.6` C++ bridge). Split into independent `engineMaxTokens` / `outputMaxTokens` with backward-compat (legacy `maxTokens` still sets both). Verified on physical iPhone 17 Pro — stock Gemma 4 E2B streamed coherent JSON for the full chunk-1 prompt.
- **Self-correction carried forward:** This issue's own premise ("stock bundle hard-capped at 2048/256") was later **disproved** — the 2048/256 figures were an artifact of the *old wrapper's conflation*, not a compiled ceiling; context is runtime-settable. Follow-up split to #15. Also fixed an over-conservative `outputMaxTokens: 200` silently truncating reflections (true compiled cap is 256).
- **Lessons:** (1) keep a vendor fork minimal (one patch, pristine base) — bundling unrelated rebuilds broke the build; (2) a conflated config knob can manufacture an apparent hard cap that doesn't exist; question postmortem "hard limits" before doing expensive re-export work.
- **Value:** postmortem-evidence
- https://github.com/emilyLi2020/Wave/issues/14

### #15 Measure the real stock Gemma 4 LiteRT context envelope (runtime sweep first; re-export is fallback)
- **Problem:** After #14, open question: do WAVE's longer surfaces (chunks 2–5 with history, >256 output) fit stock LiteRT, or is a risky re-export needed? The postmortem's "2048/256 hard cap" was disproven; three upstream sources (HF card "up to 32k"; LiteRT#6765 — 4096 works iOS arm64, 8192→nil, 16384→SIGSEGV; LiteRT-LM#2202 — E2B at 8192 on Android) say context is runtime-settable, real iOS ceiling ≈4096.
- **Fix done:** Built an on-device sweep harness (`litert-sweep.ts`): `engineMaxTokens {2048,3072,4096} × outputMaxTokens {256,512} × gpu(+cpu sanity) × {canonical,compact} × {chunk1,chunk3,chunk5,reflection}`, real production prompt builders, 90 s per-cell timeout with engine close+recreate on hang (never reuse a wedged conversation), real tokenizer counts. Ran on physical iPhone 17 Pro: **8/8 probes passed, all valid JSON, zero hangs/crashes** at eng2048/out512/gpu.
- **Outcome:** Blocker was never a compiled ceiling — it was *input size* (accumulating history + large canonical prompt) and latency. Two corner-cuts (phase narration uses only the immediately-prior check-in; chunk system block trimmed ~half) dropped late-chunk input ~2900→~1500 tok so the whole session fits eng2048 even with the canonical prompt. Real outputs 101–131 tok → out256 sufficient. eng4096 cold-start crashed — do not use. Only remaining constraint is latency (~3–4 tok/s); re-export work parked as not needed.
- **Lessons:** Runtime-sweep before re-export; design the sweep with timeout/recovery and real (not synthetic-only) prompts; an apparent "model limit" was actually a prompt-engineering / input-budget problem.
- **Value:** postmortem-evidence
- https://github.com/emilyLi2020/Wave/issues/15

### #18 Deep dive: mimic PhoneClaw's GPU-LiteRT Metal path (standalone LiteRtMetalAccelerator + dlopen-before-engine_create)
- **Problem:** Long-standing GPU blocker — requesting `backend:"gpu"` silently fell back to CPU at ~1.9 tok/s. Hypothesis: the RN fork's monolithic `LiteRTLM.xcframework` omits the Metal accelerator dylib so `litert_lm_engine_create("gpu")` can't find a Metal backend. `kellyvv/PhoneClaw` runs Gemma 4 E2B on GPU LiteRT today — deep-dive its mechanism (standalone `LiteRtMetalAccelerator.xcframework`, runtime `dlopen` *before* `engine_create`, TopK sampler deferred until *after*, embedded via Copy-Files not `LC_LOAD_DYLIB`).
- **Phase 0 finding (reframed the issue):** Read-only artifact inspection proved PhoneClaw's accelerator and our #13-rebuilt accelerator are **byte-for-byte the same Google-internal build** (identical CL `906506732`, identical `_LiteRtAcceleratorImpl` export @ identical address). The accelerator was never the differentiator. PhoneClaw's real signal: it pairs the same accelerator with a **prebuilt CLiteRTLM dylib engine**, whereas our fork links a **from-source static `ar` archive** whose `ios_arm64` Bazel staging compiles the aarch64-NEON XNNPACK microkernels *empty*.
- **Resolution:** The #18 pivot **worked** — swapping the broken from-source engine for PhoneClaw's prebuilt CLiteRTLM dynamic engine got stock Gemma 4 E2B on iPhone GPU at **~50 tok/s** (from ~1.9 CPU): `tryCreateEngine backend=gpu result=OK`, LITERT_METAL delegates 100% of subgraphs, MLDrift program-cache written on device. Recipe preserved in `docs/litert-gpu-solved/`; full proof cross-linked to Wave#13.
- **Lessons:** (1) reframe "rebuild the framework" into the cheapest disprovable experiment (inspect a working app's artifacts first — `lipo`/`otool`/`nm`/CL strings); (2) compiled symbols present ≠ runtime plugin registered before environment sealing — load ordering (`dlopen` accelerator *before* `engine_create`, defer TopK after) is the real contract; (3) the differentiator was build *form* (prebuilt dylib vs from-source static with empty XNNPACK NEON staging), not the accelerator artifact. Strong architecture-decision + postmortem evidence; the disciplined neutral-observer review passes are notable.
- **Value:** postmortem-evidence
- https://github.com/emilyLi2020/Wave/issues/18

---

## Voice loop — VAD / Whisper / TTS assembly

### #21 Full hands-free voice loop: Silero VAD → Whisper base → Gemma 4 GPU → Kokoro → playback
- **Problem:** Assemble four individually-validated subsystems (Silero VAD endpointing, Whisper base STT, Gemma 4 LiteRT GPU, Kokoro TTS) into one hands-free loop with barge-in, under tight on-device ML-memory discipline (5 model artifacts, peak ≈5+ GB on iPhone 17 Pro).
- **Architecture decisions (locked):** all models session-resident (no per-turn load/unload — lowest latency, simplest state machine), memory-budget gate before load (refuse rather than OOM-crash), deterministic teardown order, single owner per model. Barge-in is **stop-playback-only**: in-flight Gemma generation finishes silently because `sendMessageAsync` has no `AbortSignal` (a true LLM abort would cost a 2.5 GB reload — explicitly chosen not to fake an abort that doesn't exist).
- **Review pass corrections folded in:** singleton refactored to `(modelId, backend)`-keyed (passing `backend` to `preloadWaveLiteRT()` is a known no-op — forbidden as the mechanism); streaming-TTS demoted to stretch (check-in emits JSON so deltas can't stream — MVP is parse-then-speak); `llmBusy` lock + monotonic generation epoch added to prevent a second `sendMessageAsync` racing in on barge-in / discard stale-epoch output; barge-in latency relaxed to "within one VAD detection window" (~96 ms hysteresis, no hard ms bound); default keeps proven temp-WAV→`whisper.rn` path, raw-PCM gated as a spike.
- **Shipped:** Half-duplex mode (mic muted during TTS) is the device-tested default and what #21 ships. Full-duplex barge-in (native AEC patch via patch-package) implemented but unverified on device — opt-in. Streaming LLM→TTS spun out to #25.
- **Lessons:** (1) don't pretend a capability exists (no `AbortSignal` → don't fake an LLM abort); (2) a single resident LLM needs an explicit busy-lock + generation epoch or barge-in races into concurrent generation; (3) structured/JSON model output breaks naive token-streamed TTS — the streaming/structured-output/single-LLM-concurrency boundary is the real risk, not any single subsystem.
- **Value:** architecture-decision
- https://github.com/emilyLi2020/Wave/issues/21

---

_No bot, automated, or trivial issues were present — all 8 closed issues are substantive and none were skipped._
