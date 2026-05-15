## TL;DR

The browser fine-tune path documented in [`docs/wllama.md`](../blob/main/docs/wllama.md) doesn't run on iOS. wllama 3.x's bundled llama.cpp WASM build requires the [Memory64 proposal](https://github.com/WebAssembly/memory64), which Safari (and therefore every iOS browser — Apple's App Store rules force Chrome/Firefox/etc. on iOS to use WebKit) does not implement. Model load aborts with `TypeError: Conversion from BigInt to number is not allowed`. Full evidence and the cross-runtime "we tried everything" table is in [`docs/postmortems/ios-safari-browser.md`](../blob/main/docs/postmortems/ios-safari-browser.md).

For a medical hackathon where third-party cloud inference is disallowed, we need an on-device path on iOS. The plan: **port the WAVE app to React Native (Expo)** with two LLM runtimes selectable side-by-side — `llama.rn` (loads our existing Q4_K_M GGUF, native Metal) and `react-native-litert-lm` (loads our existing 4.7 GB LITERTLM bundle, native LiteRT-LM). Same model fine-tune, two runtimes, one app. Whisper STT via `whisper.rn`, Kokoro TTS via `react-native-sherpa-onnx`. All on-device, no cloud, hits hackathon constraint.

## Why React Native specifically (vs. native Swift)

Native Swift via [`llama.cpp/examples/llama.swiftui`](https://github.com/ggml-org/llama.cpp/tree/master/examples/llama.swiftui) would also work for the llama.cpp side. But native Swift **cannot hit the LiteRT track**: Google AI Edge's iOS Swift SDK for LiteRT-LM is documented as *"coming soon"* (see [LiteRT-LM docs](https://ai.google.dev/edge/litert-lm)), not shipped. The only iOS path to LiteRT-LM today is the community-maintained [`react-native-litert-lm`](https://github.com/hung-yueh/react-native-litert-lm) wrapper, which requires React Native.

React Native trade-offs:

| | React Native + llama.rn + react-native-litert-lm | Native Swift + llama.cpp.swiftui |
|---|---|---|
| Reuses existing TS/React codebase | Yes — prompt builders, schemas, Zod validation port unchanged | No — rewrite UI in SwiftUI |
| Hits llama.cpp hackathon track | Yes via `llama.rn` (native llama.cpp + Metal) | Yes via llama.swiftui |
| Hits LiteRT hackathon track | Yes via `react-native-litert-lm` | No — no Swift SDK yet |
| iOS ecosystem maturity for our model artifacts | Community wrapper for LiteRT, mature for everything else | First-party, all mature |
| Risk profile | Higher (community LiteRT wrapper) | Lower (Apple-blessed all the way) |

We pick React Native because **two tracks worth $20K beats one track worth $10K**, even if the LiteRT wrapper introduces some Saturday-night risk. Mitigation: ship `llama.rn` as the primary runtime — if `react-native-litert-lm` falls over, we still submit a working llama.cpp-track demo.

## What we hope to accomplish

### Hackathon tracks

1. **llama.cpp** — *"best innovative implementation of Gemma 4 on resource-constrained hardware."* Demo: WAVE fine-tune running on iPhone via `llama.rn`'s Metal backend. Our existing GGUF (`Maelstrome/lora-wave-session-r32/gguf/gemma-4-e2b-it-peft.Q4_K_M-*.gguf`) loads unchanged.
2. **LiteRT** — *"most compelling and effective use case built using Google AI Edge's LiteRT implementation of Gemma 4."* Demo: same WAVE fine-tune running on the same iPhone via `react-native-litert-lm`'s LiteRT-LM C++ engine, loading our existing `model.litertlm` bundle from `Maelstrome/lora-wave-session-r32/mediapipe/` (the bundle that the [MediaPipe browser postmortem](../blob/main/docs/postmortems/mediapipe-finetune.md) produced but couldn't deploy to web — now finds a consumer on mobile native).

A/B comparison of both runtimes on the same phone is the demo narrative for both tracks.

### Stretch tracks (if hackathon time allows)

3. **Cactus** — *"local-first mobile/wearable with intelligent task routing between models."* Add a VAD (Silero) and/or a small intent-classifier gate in front of the 4B fine-tune. Frame: "small model decides when large model runs." ~2-4 hours of additional integration.
4. **Ollama** — *"best project utilizing Gemma 4 running locally via Ollama."* Keep the existing web app (no rebuild) and add Ollama-as-alternative-runtime to [`client/lib/gemma/local-runtime.ts`](../blob/main/client/lib/gemma/local-runtime.ts) — `ollama serve` on `localhost:11434` serving our existing GGUF via a Modelfile. ~2-4 hours.

Targeting tracks 1 and 2 as commit. 3 and 4 are bonuses if iteration goes faster than expected.

## Architecture

```
WAVE RN app (Expo, iOS-first)
├── Inference layer (runtime selector)
│   ├── runtime-llamarn.ts             → llama.rn         → GGUF
│   └── runtime-litert.ts              → react-native-litert-lm → LITERTLM
├── Voice loop (all on-device)
│   ├── stt-whisper-rn.ts              → whisper.rn (CoreML encoder)
│   └── tts-sherpa-kokoro.ts           → react-native-sherpa-onnx
└── UI (RN port of existing WAVE flows)
    ├── PhaseScreen      (uses buildChunkPrompt)
    ├── CheckInScreen    (uses buildCheckInPrompt)
    └── ReflectionScreen (uses buildReflectionPrompt)
```

Hardware allocation on iPhone (clean separation, no compute fights):

| Component | iOS hardware path |
|---|---|
| Gemma via `llama.rn` | Metal GPU |
| Gemma via `react-native-litert-lm` | LiteRT GPU/NPU (via ML Drift) |
| Whisper encoder | Neural Engine (CoreML) |
| Whisper decoder | Metal GPU |
| Kokoro TTS | Neural Engine or GPU via ONNX Runtime |

## What ports from the existing codebase, what gets rebuilt

**Ports unchanged (pure TS, no DOM/Web APIs):**
- [`client/lib/prompts/chunk-generator.ts`](../blob/main/client/lib/prompts/chunk-generator.ts)
- [`client/lib/prompts/check-in.ts`](../blob/main/client/lib/prompts/check-in.ts)
- [`client/lib/prompts/reflection.ts`](../blob/main/client/lib/prompts/reflection.ts)
- [`client/lib/prompts/schemas.ts`](../blob/main/client/lib/prompts/schemas.ts) — Zod schemas
- All runtime guards and validation logic

**Gets replaced:**
- [`client/lib/wllama/`](../blob/main/client/lib/wllama/) → two new wrappers, one each around `llama.rn` and `react-native-litert-lm`, both exposing a `createChatCompletion({ messages })`-shaped surface so the prompt code calls them identically.
- React DOM components → React Native (`<View>`, `<Text>`, `Pressable` instead of `<div>`, `<span>`, `<button>`).
- Voice-test page (`client/app/models/voice-test/`) → native pipeline via `whisper.rn` + `react-native-sherpa-onnx`.

**Stays as-is:**
- Desktop web app at `client/` — no changes. Keeps serving the working wllama-backed surface. Useful if we add the Ollama track.

## Order of operations (de-risk unknowns first)

1. **Smoke test `llama.rn` with our GGUF** (~1 hour). Mature library + standard GGUF format = lowest risk. Validates the RN toolchain works before any UI port.
2. **Smoke test `react-native-litert-lm` with our LITERTLM** (~2-4 hours). Highest risk — community wrapper, larger artifact, our specific `litert-torch export_hf` output is what the web SDK choked on (different consumer, should work, must verify). **If this fails, abandon the LiteRT track and refocus on llama.cpp + Cactus.**
3. **Port prompt code + minimal UI** (~Day 1). Three screens, runtime selector, three "Run" buttons. Validates the three WAVE flows on both runtimes.
4. **Add Whisper + Kokoro** (~Day 1-2). Same family of native modules as `llama.rn`, similar install patterns.
5. **Polish + record demo + writeup** (~Day 2).

## Risks

- **`react-native-litert-lm` is a community wrapper with limited contributors.** A bug Saturday night means patching their C++ glue ourselves. Have `llama.rn` as primary so we can drop the LiteRT track and still submit.
- **LITERTLM at 4.7 GB cannot be bundled in the app binary.** Download on first launch and cache in app sandbox storage. The wrapper supports this per its docs; verify in smoke test #2.
- **`com.apple.developer.kernel.increased-memory-limit` entitlement is required** for the 3.2 GB GGUF and 4.7 GB LITERTLM. This entitlement requires the paid Apple Developer Program ($99/yr). **Sign up immediately** — new-account approval can take 24-48 hours.
- **Windows-only dev means slow iteration.** No Mac → Expo EAS Build (cloud iOS builds, ~10-15 min per native-code change) instead of local Xcode. JS changes still hot-reload normally.
- **Simulator vs device matters for LiteRT.** LiteRT NPU paths don't work in Simulator. Must validate on a physical iPhone.

## Acceptance

Track 1 (llama.cpp):
- [ ] RN app loads `gemma-4-e2b-it-peft.Q4_K_M.gguf` via `llama.rn` on a physical iPhone.
- [ ] All three WAVE prompts (phase / check-in / reflection) produce coherent on-template output matching the Python-runtime ground truth in `Maelstrome/lora-wave-session-r32/mediapipe/wave-outputs.json`.
- [ ] Demo video + writeup includes real-device tokens/sec numbers.

Track 2 (LiteRT):
- [ ] RN app loads `model.litertlm` via `react-native-litert-lm` on a physical iPhone.
- [ ] Same three WAVE prompts produce coherent output.
- [ ] Demo video shows both runtimes selectable and producing comparable output.

Shared:
- [ ] Whisper STT and Kokoro TTS run on-device, no cloud calls.
- [ ] Repo at submission time installs cleanly with documented setup steps.

## Out of scope for this issue

- Production App Store distribution (TestFlight build for the hackathon submission is fine; App Store review is post-hackathon).
- iOS Safari browser path — closed by Memory64. See [`docs/postmortems/ios-safari-browser.md`](../blob/main/docs/postmortems/ios-safari-browser.md).
- Android port (RN supports it, but we're iOS-only for the hackathon demo; Android would Just Work via `llama.rn`'s prebuilt JNI libs if we needed it).
- Replacing the existing desktop web app — stays as-is.

## References

- iOS Safari postmortem: [`docs/postmortems/ios-safari-browser.md`](../blob/main/docs/postmortems/ios-safari-browser.md)
- Existing wllama desktop doc: [`docs/wllama.md`](../blob/main/docs/wllama.md)
- Sibling browser-runtime postmortems: [`docs/postmortems/`](../blob/main/docs/postmortems/)
- Upstream blocker for browser path: [ngxson/wllama#210](https://github.com/ngxson/wllama/issues/210)
- LiteRT-LM iOS Swift SDK status: ["coming soon" per Google AI Edge docs](https://ai.google.dev/edge/litert-lm)
- React Native runtime packages:
  - [`mybigday/llama.rn`](https://github.com/mybigday/llama.rn) — llama.cpp Metal binding
  - [`hung-yueh/react-native-litert-lm`](https://github.com/hung-yueh/react-native-litert-lm) — LiteRT-LM Nitro module wrapper
  - [`mybigday/whisper.rn`](https://github.com/mybigday/whisper.rn) — whisper.cpp CoreML binding
  - [`XDcobra/react-native-sherpa-onnx`](https://github.com/XDcobra/react-native-sherpa-onnx) — Sherpa-ONNX TurboModule with Kokoro support
