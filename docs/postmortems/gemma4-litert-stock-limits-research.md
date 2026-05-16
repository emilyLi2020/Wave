# Stock Gemma 4 LiteRT-LM on React Native iOS: what works and what's blocked by a wrapper bug

> Sibling report to [`litert-lm-mobile-finetune.md`](./litert-lm-mobile-finetune.md)
> (which covered why our fine-tune bundle doesn't load).
> This one covers why even **stock** `litert-community/gemma-4-E2B-it.litertlm`
> can't run the full WAVE chunk-1 prompt through `react-native-litert-lm@0.3.6`,
> what the actual blocker is, and what would unblock it.
>
> Audience: anyone debugging "Failed to invoke the compiled model" or
> "input token ids are too long" errors on this stack with prompts >~200
> tokens. Stack-trace pattern recognition for the next person who hits this.

## TL;DR

| Use case | Stock bundle + `react-native-litert-lm@0.3.6` |
|---|---|
| Short prompt (<200 tokens), short output | ✅ Works |
| Long prompt (~1800 tokens) like the full WAVE chunk-1 | ❌ Impossible — see "The wrapper bug" |
| Function calling via Gemma 4's native tool tokens | ✅ Works via prompt engineering — engine emits the 6 special tool tokens, wrapper doesn't strip them |
| JSON-schema-enforced output via llguidance | ❌ The Rust grammar deps are stubbed out in the iOS Bazel build |
| Multimodal (vision/audio) | ❌ iOS XCFramework lacks compiled vision/audio executors |

So the prize-eligible "uses LiteRT" demo with stock works **if** the demo
uses short prompts. The WAVE chunk-1 prompt at ~1846 input tokens does not
fit the stack as currently shipped. The blocker is a wrapper bug, not a
runtime limit.

## The decisive evidence

### Stock bundle's compiled budget (from litert-community HF README)

> "All benchmarks were taken using **1024 prefill tokens** and **256 decode
> tokens** with a **context length of 2048 tokens** via LiteRT-LM."

So the bundle's flatbuffer graph is compiled with:

- `cache_length` ≈ 2048 (total KV-cache budget for input + output combined)
- `prefill_lengths` likely includes 1024 (the benchmark's chunk size)
- `decode_max_tokens` ≈ 256 (per-call decode chunk size)

The model architecture supports 32K context per Google's marketing, but
**this specific bundle's compiled graph supports only 2048 total**.

### What `react-native-litert-lm@0.3.6` actually does with the `maxTokens` config

From `node_modules/react-native-litert-lm/cpp/HybridLiteRTLM.cpp` lines 320 + 378:

```cpp
// Line 321 — engine-wide cache budget:
litert_lm_engine_settings_set_max_num_tokens(settings, static_cast<int>(maxTokens_));

// Line 378 — per-session decode output cap:
litert_lm_session_config_set_max_output_tokens(session_config_, static_cast<int>(maxTokens_));
```

**Same `maxTokens_` value applied to both.** That is a wrapper bug.
`engine.max_num_tokens` and `session.max_output_tokens` are two distinct
LiteRT-LM C API parameters that should be set independently. The wrapper's
public `LLMConfig.maxTokens` collapses them into one knob.

The TypeScript docstring claims `maxTokens` is "Maximum number of tokens to
generate, @default 1024" (lib/specs/LiteRTLM.nitro.d.ts) — but the
implementation also writes it to the engine-wide cache size.

### Test matrix that exposed the bug

All on physical iPhone 17 Pro, stock `litert-community/gemma-4-E2B-it.litertlm`, full WAVE chunk-1 prompt at 1846 tokens:

| `maxTokens` config | What `engine.max_num_tokens` becomes | What `session.max_output_tokens` becomes | Outcome |
|---|---|---|---|
| 256 | 256 | 256 | `input token ids are too long, 1846 > 256` — engine cache too small for input |
| 512 | 512 | 512 | Same error |
| 1024 | 1024 | 1024 | Even with a *short* 60-token prompt: `failed to invoke the compiled model` — session asks for 1024 decode tokens but compiled graph's per-call decode chunk caps at 256 |
| 2048 | 2048 | 2048 | `failed to invoke the compiled model` — input fits cache, but session asks for 2048-token decode chunk that the graph can't invoke |
| 8192 | 8192 | 8192 | Same; just bigger illegal decode batch |

For the WAVE prompt specifically, you would need:

- `engine.max_num_tokens` ≥ ~1900 (to hold the 1846-token input plus some output) AND
- `session.max_output_tokens` ≤ 256 (compiled decode-chunk cap)

These are mutually exclusive under the current wrapper. **There is no
single value of `maxTokens` that satisfies both** for prompts above the
bundle's compiled decode chunk size.

### What the engine call actually fails on

The wrapper's `loadModel` constructs an `LlmInferenceEngineSettings`,
calls `litert_lm_engine_settings_set_max_num_tokens`, then creates the
engine. Engine creation succeeds when `maxTokens` is high enough for the
graph's metadata to validate, but inference fails inside
`generateResponse` → `litert_lm_session_run_prefill` /
`litert_lm_session_run_decode` when the requested decode batch size
exceeds what the compiled tflite graph's static shapes accept.

The "Failed to invoke the compiled model" message comes from the LiteRT
runtime's `Interpreter::Invoke()` returning a non-OK status because the
input tensor shape doesn't match a compiled subgraph signature.

## What the public record says

### litert-community HF discussions confirm the same shape

- **[Discussion #16 "New gemma-4-E2B-it.litertlm broken!"](https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/discussions/16)** — user `lktinhtemp` hits *exactly* the error we did: *"Failed to create engine. Model may be invalid"*. Staff response: update your AI Edge Gallery app to the latest version. This is the same wrapper-version-skew pattern as our `react-native-litert-lm@0.3.6` issue: stock bundle gets rebuilt with new C API, older app/wrapper rejects it.
- **[Discussion #15 "Convert finetuned google/gemma-4-E2B-it model to liteRT-LM"](https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/discussions/15)** — `SalihHub` asks for fine-tune conversion guide; 21 comments, no working recipe surfaced.
- **[Discussion #14 "Conversion from fine tuned merged model"](https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/discussions/14)** — `darahask` asks for the exact conversion params used to produce the official bundle. 16 days open. **Zero staff response.** Confirms the bundle's compiled settings are undocumented and the public converter doesn't match.
- **[Discussion #7](https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/discussions/7)** — `QSCB` (LiteRT Community staff) posts a 3-stage roadmap using MediaPipe Python Converter. User `MuradAlmakhzangi` immediately reports it errors with `ValueError: Unknown special model: GEMMA_4_E2B`. The staff-provided recipe doesn't work.

So: nobody outside Google has a working public conversion recipe; the
official bundle's compiled prefill/decode settings are not documented;
and the wrapper bug we found locally is consistent with what Gallery-app
users report.

### Function calling status (good news)

Gemma 4 has **native function calling baked into the model architecture
via 6 dedicated special tokens** for tool declarations, calls, and
responses (per Google's blog, vLLM recipes, and MachineLearningMastery's
write-up — search "Gemma 4 tool calling"). The LiteRT-LM CLI explicitly
intercepts the JSON tool-call output the model emits.

Through `react-native-litert-lm`:

- Wrapper's output-cleanup strips `<end_of_turn>`, `<start_of_turn>`, `<eos>` (see `cpp/HybridLiteRTLM.cpp` `stripControlTokens`) but **does not strip the tool-call tokens** — they pass through to the JS layer.
- So you write tool definitions as JSON schema in the prompt, the model emits a tool-call JSON object, JS parses it. Same pattern WAVE already uses for the check-in schema and chunk schema.
- No engine-level JSON-schema enforcement is available (the Rust `llguidance` dependency is stubbed in the iOS Bazel build per the agent's #13 follow-up). Reliability comes from Gemma 4's training, not from a grammar constraint.

Function calling is therefore **usable on this stack** so long as prompts
fit in the budget.

## Recommended paths forward, ranked

### Path A: Fork `react-native-litert-lm` and unconflate the two config knobs

**Effort:** ~2-4 hours. Real surface area: 1 C++ function and the TypeScript types.

**The actual change:**

```cpp
// in HybridLiteRTLM.cpp loadModelInternal()
// Replace single maxTokens_ with two distinct knobs:
litert_lm_engine_settings_set_max_num_tokens(settings, static_cast<int>(engineMaxTokens_));     // total cache budget
litert_lm_session_config_set_max_output_tokens(session_config_, static_cast<int>(outputMaxTokens_));  // per-call decode cap
```

And expose `engineMaxTokens?: number` and `outputMaxTokens?: number` in
`LLMConfig`. Default `engineMaxTokens` to the model's cache_length if
specified in bundle metadata (2048 for stock Gemma 4 E2B). Default
`outputMaxTokens` to 256 for stock bundle.

With this fix, WAVE chunk-1 prompt (1846 tokens) becomes possible:

- `engineMaxTokens: 2048` — fits the 1846-token input plus ~200 output
- `outputMaxTokens: 200` — within compiled decode chunk cap

Output of 200 tokens is enough for a short meditation chunk. Still
constrained by the bundle's compiled cache_length=2048, but usable.

To open a PR upstream or fork, the wrapper is single-file: `cpp/HybridLiteRTLM.cpp`.

#### Outcome — Path A implemented (2026-05-16)

Path A was taken. Fork published at
[`IdkwhatImD0ing/react-native-litert-lm-wave`](https://github.com/IdkwhatImD0ing/react-native-litert-lm-wave)
(branch `wave/maxtokens-decouple`, based on upstream `0.3.6`), consumed by
`mobile/package.json` as a git dependency:
`"react-native-litert-lm": "github:IdkwhatImD0ing/react-native-litert-lm-wave#wave/maxtokens-decouple"`.

What changed in the fork vs upstream `0.3.6`:

- **`cpp/HybridLiteRTLM.{hpp,cpp}`** — added `engineMaxTokens_` (default
  2048) and `outputMaxTokens_` (default 256) members. Config parsing now
  resolves: explicit knob → legacy `maxTokens` → default. Line 334 feeds
  `engineMaxTokens_` to `litert_lm_engine_settings_set_max_num_tokens`;
  line 391 feeds `outputMaxTokens_` to
  `litert_lm_session_config_set_max_output_tokens`. The two knobs are no
  longer the same value.
- **`nitrogen/generated/shared/c++/LLMConfig.hpp`** — the Nitro struct is
  codegen'd, so it was hand-extended: two `std::optional<double>` members,
  constructor params given `= std::nullopt` defaults (so the Android
  `JLLMConfig` 6-arg call site still compiles untouched), and
  `fromJSI` / `toJSI` / `canConvert` updated.
- **`src/specs/LiteRTLM.nitro.ts` + `lib/specs/LiteRTLM.nitro.d.ts`** —
  typed `engineMaxTokens?` / `outputMaxTokens?`; `maxTokens` marked
  `@deprecated` (kept as the back-compat fallback for both).
- **`scripts/postinstall.js`** — extracts a committed
  `LiteRTLM-ios-frameworks.zip` (the rebuilt `main-2f70ce8` framework from
  Issue #13, 64 MB, tracked in the fork) instead of downloading the stale
  upstream `v0.3.6` release asset — which is the v0.10.2 framework and has
  404'd before ([upstream #9](https://github.com/hung-yueh/react-native-litert-lm/issues/9)).
  This makes a clean `npm install` reproduce the known-good runtime;
  previously the `main-2f70ce8` framework only existed as an
  un-reproducible local mutation of `node_modules` on other branches.

WAVE call sites updated to the split knobs:

- `src/screens/LiteRTStockScreen.tsx` (the prize-eligible stock demo):
  `engineMaxTokens: 2048, outputMaxTokens: 200` — the 1846-token chunk-1
  prompt now fits without slimming.
- `src/screens/LiteRTSmokeScreen.tsx`: same 2048 / 200.
- `src/runtime/litert-generators.ts` (parked fine-tune path): `4096 / 256`
  to match that bundle's `--cache_length=4096` export.

Verified locally: git-dep install resolves the fork (`lib/` ships
committed, no `prepare` build needed), `postinstall` extracts the
`main-2f70ce8` xcframework into `ios/Frameworks/` (podspec vendors exactly
that path), and `npx tsc --noEmit` on the mobile app is clean with the new
knobs. **Not yet verified:** the native C++ compiles only at EAS/Xcode
build time, and the decisive proof — the full 1846-token WAVE chunk-1
prompt actually generating on a physical iPhone through stock Gemma 4 —
still needs the `/tests/litert-stock` on-device smoke. That is the
remaining open item for this path.

### Path B: Use a different bundle with a larger compiled cache

The litert-community org publishes only `gemma-4-E2B-it.litertlm` and
`gemma-4-E4B-it.litertlm`. Both follow the same 2048 / 256 compile profile
per their README benchmarks. Other Gemma series have suffixes hinting at
config: `Gemma3-1B-IT_multi-prefill-seq_q4_ekv4096` (ekv = effective KV
cache, 4096 here). **No Gemma 4 variant with ekv4096+ has been published
as of 2026-05-16.** Sourcing one means converting it ourselves, which
hits the converter-side bugs we already documented in the sibling
postmortem.

### Path C: Switch to `llama.rn` + GGUF

Already documented in the [pivot plan's contingency](../../mobile/docs/architecture.md)
and validated by the [parallel-cli research run](#research-references).
GGUF context length is configurable at load time and is **not capped by
a compile-time graph**. `xmpuspus/airgap` ships Gemma 4 E2B on iPhone via
`mybigday/llama.rn` already. Function calling via Gemma 4's native tool
tokens works the same way through `llama.cpp`.

Doesn't satisfy the LiteRT prize requirement on its own. **Hybrid
recommendation:** keep stock Gemma 4 + LiteRT in `/tests/litert-stock`
for the prize demo (with whatever prompt fits in the 2048 budget), and
ship `llama.rn` + GGUF for the production WAVE flows that need the
fine-tune behavior and long prompts.

### Path D: Apple MLX via a native Swift module (long-term best performance)

Best on-device performance per the research (12-14 tok/s on iPhone 17 Pro
class hardware via `yejingyang8963-byte/Swift-gemma4-core`). Requires
writing a native Swift Expo Module from scratch. ~1-2 days work, no
React Native wrapper exists yet for this path.

## Recommendation for WAVE specifically

**Short-term (hackathon, prize-eligible LiteRT demo):**

Path A. The 1-file fork is the lowest-effort fix that closes the wrapper
bug AND lets the WAVE chunk-1 prompt run on stock Gemma 4. Cost: an
afternoon of C++ + TypeScript + a fork URL in `package.json`. Outcome:
prize demo works with the actual WAVE prompts (just shorter outputs).

**Medium-term (post-hackathon, fine-tune behavior):**

Path C. `llama.rn` + GGUF for the actual production-quality fine-tune
delivery. We have the GGUF shards already. ~3-4 hours of wiring.

**Long-term (best UX):**

Path D. MLX-Swift native module. Higher tok/s, lower memory, but
non-trivial native development.

## What we are *not* recommending

- Continuing to debug the LiteRT-LM C API mismatch in our rebuilt
  XCFramework (the agent's commit on `artemis/litert-ios-framework-installer`).
  Per their own follow-up on issue #13, framework-swap-only is not
  enough — porting the wrapper's bridge to the new C API is a separate
  multi-day project.
- Iterating further on litert-torch bundle exports. The metadata builder
  is upstream-broken for Gemma 4 ([`litert-torch#998`](https://github.com/google-ai-edge/litert-torch/issues/998), [`#994`](https://github.com/google-ai-edge/litert-torch/issues/994), [`#995`](https://github.com/google-ai-edge/litert-torch/issues/995)), and even a successful export hits the wrapper's ABI mismatch.

## Research references

- Maintainer's working example: [`react-native-litert-lm/example/App.tsx`](https://github.com/hung-yueh/react-native-litert-lm/blob/main/example/App.tsx) — uses `maxTokens: 1024` with the same stock bundle but only short prompts
- Gemma 4 native tool calling: [Google blog](https://blog.google/innovation-and-ai/technology/developers-tools/gemma-4/), [ai.google.dev function calling](https://ai.google.dev/gemma/docs/capabilities/text/function-calling-gemma4), [vLLM recipe](https://docs.vllm.ai/projects/recipes/en/latest/Google/Gemma4.html)
- Proven RN path for Gemma 4 fine-tunes on iPhone: [`mybigday/llama.rn`](https://github.com/mybigday/llama.rn) used by [`xmpuspus/airgap`](https://github.com/xmpuspus/airgap)
- Proven Swift native path: [`yejingyang8963-byte/Swift-gemma4-core`](https://github.com/yejingyang8963-byte/Swift-gemma4-core) + the "Off Grid" App Store app
- Wrapper bug source: [`mobile/node_modules/react-native-litert-lm/cpp/HybridLiteRTLM.cpp`](https://github.com/hung-yueh/react-native-litert-lm/blob/main/cpp/HybridLiteRTLM.cpp) lines 320-378

## What ships now

- **Stock Gemma 4 LiteRT page** (`/tests/litert-stock`) — Path A shipped
  (see "Outcome" above). The fork's split `engineMaxTokens: 2048` /
  `outputMaxTokens: 200` removes the conflation, so the full 1846-token
  chunk-1 prompt no longer needs slimming. Pending the on-device iPhone
  smoke to confirm generation end-to-end.
- **Existing `/tests/litert`** (fine-tune target) — stays parked behind issue #13 / #11.

The deeper research run from parallel-cli is saved at
`.tmp-research-output.md` and should be moved to a permanent docs/
location before being garbage-collected.
