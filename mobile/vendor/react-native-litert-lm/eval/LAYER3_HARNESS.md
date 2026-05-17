# Layer 3 — on-device eval suite

Wires the verified Layer 1 methodology into the example app so it runs on a
real iPhone **through the public wrapper API** — the actual ship path for the
2026-05-18 demo.

## Where

| File | What |
|---|---|
| `example/wave-eval/wave-prompts.json` / `wave-outputs.json` | Canonical assets (copies of `eval/`) bundled into the app. |
| `example/wave-eval/score.ts` | Dependency-free TS port of `eval/run.mjs` scoring — **identical gates** (broken-quant signatures, surface structure, paraphrase-robust BoW cosine; char/word edit distance informational). |
| `example/wave-eval/WaveEvalScreen.tsx` | Self-contained screen: its own `useModel`, runs the suite, renders the pass/fail matrix + perf + peak RSS. |
| `example/App.tsx` | One isolated addition: a 🌊 header button → `WaveEvalScreen` (chat path untouched). |

## What it does (issue #1 §6 Layer 3)

1. `useModel(WAVE_URL, { backend, maxTokens: 4096, temperature: 0, topK: 1 })`
   — `WAVE_URL` = the public HF `mediapipe/model.litertlm`.
2. **Run** → `load()` (downloadModel → loadModel with progress).
3. For each of the 3 surfaces: `resetConversation()` →
   `sendMessageAsync(systemPrompt + "\n\n" + userPrompt, …)` — greedy, exactly
   reproducing the Layer 1 CLI run, but on device through the wrapper.
4. Score with `score.ts` (same thresholds as `eval/run.mjs`); capture
   `getStats().tokensPerSecond` + elapsed ms per prompt.
5. Render per-surface PASS/FAIL matrix, output preview, overall verdict, and
   **peak RSS** (flags `>6 GB`, the issue's memory wall).

## Status

Verified on this box:

- ✅ **Code complete + typechecks** (`cd example && npx tsc --noEmit`, strict,
  exit 0 — includes `wave-eval/` + the App.tsx wiring).
- ✅ **iOS frameworks installed & integrity-verified.** The fixed
  `scripts/postinstall.js` ran end-to-end: pulled the Wave team's HF-hosted
  build, **SHA-256 matched the published hash**, extracted
  `ios/Frameworks/LiteRTLM.xcframework` with both `ios-arm64` (device) and
  `ios-arm64-simulator` slices (171 MB, valid Info.plist). The packaging
  blocker is genuinely cleared, not just patched.
- ✅ **iOS native project generates with the package + frameworks**
  (`expo prebuild --platform ios --clean` exit 0).
- ✅ **Full iOS Release build + install + autorun on iPhone 17 Pro simulator**
  (Xcode 26.5, arm64 — note the xcframework has no legacy `x86_64` simulator
  slice by design, so simulator builds must be arm64-only). The app launched
  straight to the eval screen, `downloadModel` fetched the full 5 GB bundle
  (verified on disk, readable), and `loadModel` was invoked through the wrapper.

Also done: built+signed (paid team, auto-provisioned, memory entitlements
granted) and ran on a **physical iPhone 17 Pro** (iOS 26.4.2). `downloadModel`
fetched the full 5 GB bundle on-device; the autorun + `WAVE_EVAL_RESULT::`
capture path works in a RN **release** build (verified via the device unified
log).

### ⛔ DEFINITIVE ROOT CAUSE — the prebuilt iOS xcframework is mispackaged

`loadModel` fails on **both simulator and device**, for the WAVE bundle *and*
the stock `litert-community/gemma-4-E2B-it` bundle, with:

```
Failed to create engine: NOT_FOUND: No available engine for backend: CPU.
Preferred engine types: [kAdvancedLiteRTCompiledModel, kLiteRTCompiledModel].
Available (registered) engine types: []
```

Diagnosis (this corrects the earlier "simulator-only" guess):

- It is **not** the model bundle (Layer 1 proved it generates correct
  fine-tuned output on the litert-lm runtime), not memory/entitlements (those
  were granted; failure precedes load), not signing, not our wrapper, not the
  device.
- The `LiteRTLM.framework` binary is a **static `ar` archive**. Its LiteRT
  engines self-register via **file-local C++ static initializers**. Linked
  normally the linker dead-strips those TUs → **empty engine registry**.
- `-force_load` / `-all_load` are the only way to keep them, but doing so drags
  in the framework's **bundled miniaudio** → **~1171 duplicate symbols** vs the
  wrapper's own miniaudio → link fails.
- `nm` over all **5886** framework symbols finds **no externally-referenceable
  engine symbol**, so a surgical `-u <symbol>` cannot pull just the engine
  object files. There is **no clean linker-flag fix.**

**Resolution: the iOS xcframework must be rebuilt from LiteRT-LM source**
(`scripts/build-ios-engine.sh`) with the engine targets registered and without
bundling conflicting third-party libs (or shipped as a properly-linked dynamic
framework). This is issue #1 **§4** — a separate, heavy Bazel/iOS effort
(budgeted 8–12 h), not a quick patch. The HF build's own metadata foreshadowed
this ("stubbed dependencies"; only ever smoke-tested via the *macOS* CLI, never
on iOS).

> **CORRECTION (supersedes the section below).** An observer (GPT-5.5)
> correctly flagged that the "independent defect #2" was measured on a
> **contaminated link line**: the `-force_load` source was reverted but the
> generated Xcode project was never regenerated, so a stale
> `-force_load …/LiteRTLM.framework/LiteRTLM` persisted in
> `project.pbxproj` + `Pods-LLMTest.*.xcconfig`. Both "defect #2" device
> builds in fact had `-force_load` on the `Ld` line. A clean-state validation
> — rebuild framework from the original script + patch, `expo prebuild
> --clean`, fresh `pod install`, **verified zero `force_load` anywhere**,
> inspect `Ld` (no `-force_load`) — **`BUILD SUCCEEDED`**: no duplicate, no
> undefined symbols, 321 engine symbols in the app binary. **Defect #2 is
> withdrawn — it was not real.** The unmodified podspec + original build
> script link cleanly with the patched framework. The remaining blocker is a
> new finding #3 (compiled-model/runtime-version), below.

### §4 rebuild was performed — outcome: defect #1 fixed, defect #2 revealed

The xcframework was rebuilt from LiteRT-LM **v0.10.2** + this repo's
`scripts/patches/ios-engine-fixes.patch` (Bazelisk 1.29.0 / Bazel 7.6.1 /
Xcode 26.5; Bazel cache was warm so it took minutes, not the budgeted hours).

**Defect #1 (empty engine registry) — FIXED & verified.** The Wave team's
HF framework was built from LiteRT-LM `main`, so the `v0.10.2` patch never
applied. Building `v0.10.2` *with* the patch: `c/engine.cc` now calls
`ForceLinkEngineImpl()` (the patch's external anchor, outside the anon
namespace), and the rebuilt framework contains the LiteRtCompiledModel engine
code — **13+ engine symbols vs 0** in the HF build. This is the correct fix and
needs **no `-force_load`** (so no miniaudio collision from that path).

**Defect #2 (independent, now the blocker) — miniaudio double-definition at
the consuming app link.** The `v0.10.2` source build's miniaudio
implementation is emitted by `external/miniaudio/.../miniaudio.o` (sole
definer of ~1171 `_ma_*`), while `runtime/components/preprocessor/.../
audio_preprocessor_miniaudio.o` *references* a 5-symbol `_ma_decoder_*`
subset. The app link fails with **~1171 duplicate `_ma_*` symbols**, both
cited as the *same* `LiteRTLM[863](miniaudio.o)` member — i.e. the static
framework's miniaudio is effectively pulled twice into the final image. The HF
`main` build did **not** exhibit this (different source layout / symbol
visibility), but it had defect #1. So **neither the HF framework nor the
v0.10.2 rebuild is consumer-usable as-is — for different reasons.**

Tried & ruled out (bounded, then stopped per plan): basename-dedupe of the
object list → drops distinct same-basename TfLite objects → undefined TfLite
symbols. Content-hash dedupe → no-op (objects are distinct). Excluding the
standalone `external/miniaudio` object → 5 `_ma_decoder_*` undefined (the
preprocessor only references them). None is a clean fix; the speculative
build-script edits were reverted.

**Properly-scoped remaining work (genuine §4, not a quick patch):** make the
v0.10.2 static framework link cleanly — options: (a) build miniaudio with
hidden/`__private_extern__` visibility or as a single weak-symbol TU; (b) fix
the consumer link topology so the LiteRTLM static archive is referenced once;
(c) replace the script's "find every `.o` + libtool-merge" with proper Bazel
target selection (`bazel build //c:engine` linkable output) so only one
miniaudio impl is included. Each needs real investigation of the v0.10.2
Bazel graph + the CocoaPods link line — the issue's budgeted 8–12 h effort.

### Net Layer 3 status (corrected)

RN/integration side fully proven (signing, paid-team provisioning + memory
entitlements, autorun, `downloadModel` of the 5 GB bundle on-device, clean
link). **Defect #1 (empty registry) is fixed** by the `v0.10.2`+patch source
build, *verified on device*: the engine now registers, initializes TF-Lite,
and attempts to load the model. **Defect #2 is withdrawn** (stale-`-force_load`
artifact; observer-credited).

**Remaining blocker — finding #3 (hypothesis, not asserted):** on-device the
`v0.10.2` LiteRT compiled-model executor fails creating the model from
`mediapipe/model.litertlm`:

```
Failed to create engine: INTERNAL: ERROR:
  [runtime/executor/llm_litert_compiled_model_executor.cc:1568]
  └ ERROR: [external/litert/litert/cc/litert_compiled_model.h:1140]
```

(`TF_LITE_VISION_ENCODER` / `TF_LITE_AUDIO_ENCODER_HW` "not found" are benign —
optional-encoder probes on a text-only model.) Root status text not surfaced.

**Version-mismatch hypothesis: TESTED → REFUTED.** `litert-lm==0.10.1` (PyPI;
the v0.10.x runtime line — iOS is git `v0.10.2`, and `0.11.0` already passed
Layer 1) loaded `mediapipe/model.litertlm` and generated **byte-identical**
WAVE JSON to Layer 1, exit 0, zero engine-creation errors. So the v0.10.x
runtime handles this exact bundle perfectly on host — **it is not a
runtime-version or model-format problem, and not the bundle.**

**Therefore finding #3 is iOS-cross-build-specific.** The defect is in how
*this iOS xcframework* is produced — candidate causes (none proven): the
stubbed Rust/llguidance deps + `LITERT_LM_FST_CONSTRAINTS_DISABLED=1`, a
TFLite delegate/op absent in the iOS cross-compile, or the build script's
"find every `.o` + libtool-merge" packaging dropping/duplicating something the
compiled-model executor needs at runtime. This is genuine §4 build
engineering (investigate the iOS build config/stubs/packaging) — but the
"rebuild from a newer LiteRT-LM tag" path is now **ruled out**.

**Layer 1 remains the verification of record** that the WAVE fine-tune is
intact and the bundle is shippable on the LiteRT runtime.

## Acceptance (issue #1 §6 Layer 3)

- 3/3 surfaces PASS their gates (expected — Layer 1 already passed with these
  exact prompts/decoding).
- `reflection` parses to the WAVE JSON schema; `checkin`/`phase` are WAVE
  clinical prose (no base-Gemma voice, no pad/garbage).
- tok/s within ~30% of the llama.rn GGUF baseline (record on the demo device).
- Peak RSS < 6 GB during the 3-prompt run.
- Regression guard: loading a stock litert-community Gemma bundle through the
  same app still produces coherent base output.
