# Wave mobile (React Native, iOS-first)

Native iOS port of the Wave fine-tune. The web app at `../client/` is closed on iOS Safari by the WASM Memory64 requirement (see `../docs/postmortems/ios-safari-browser.md`); this app runs the same Gemma 4 fine-tune natively via LiteRT-LM and ships a full VAD-driven voice loop.

## Docs

- **[`docs/handoff.md`](./docs/handoff.md)** — read this if you just cloned the repo. Step-by-step first-launch checklist, gotchas, where to look when things break.
- **[`docs/architecture.md`](./docs/architecture.md)** — deep dive on the stack, port boundary, runtime contract, model cache, routing, and known TODOs.
- **[Claude plan](`~/.claude/plans/take-a-look-at-fizzy-melody.md`)** — the pivot plan this work is executing against.

## Stack

| Layer | Library | Notes |
|---|---|---|
| Runtime | `react-native-litert-lm` (Nitro) | Primary. Loads `model.litertlm` from HF on first launch. |
| Runtime contingency | `llama.rn` | Only wired if the LiteRT smoke fails. |
| STT | `whisper.rn` + CoreML encoder | Step 5b. |
| TTS | `react-native-sherpa-onnx` (Kokoro) | Step 5b. |
| VAD | `onnxruntime-react-native` + bundled Silero v5 | Step 5a. Lets us port `client/lib/voice/vad-listener.ts` verbatim. |
| Framework | Expo SDK 54 + Expo Router + Reanimated | New Arch enabled (required for Nitro). |

## One-time setup (host)

1. **Apple Developer Program enrollment** (~$99/yr, 24-48h approval). Required for the `com.apple.developer.kernel.increased-memory-limit` entitlement that keeps the 2.56 GB Gemma LiteRT-LM bundle + voice models resident.
2. Install Expo + EAS CLI: `npm i -g eas-cli`.
3. `eas login` with the same Apple-linked Expo account.
4. Register the physical iPhone 15 Pro / 16 Pro UDID in the Apple Developer portal **and** with EAS (`eas device:create`).
5. Update `app.json > expo.ios.bundleIdentifier` if you need a non-placeholder bundle ID for your Apple team.

## Build

Windows host: **all iOS builds are cloud builds via EAS** (no local Xcode). Expect ~10-15 min per native-code change. JS-only changes hot-reload normally via `npx expo start`.

```bash
# Development build for a physical device (recommended for LiteRT + CoreML smoke testing).
eas build --profile development --platform ios

# Simulator build for UI work without a device. CoreML / LiteRT GPU paths will not run here.
eas build --profile development-simulator --platform ios
```

After the IPA installs (TestFlight or ad-hoc), run the JS dev server locally:

```bash
npx expo start --dev-client
```

## Dependency notes

- `react-native-litert-lm@0.3.6` is pinned. The package's bundled iOS framework is stale for WAVE's Gemma 4 LiteRT-LM bundle, so `npm install` runs `scripts/install-litert-ios-framework.js` to fetch the rebuilt `LiteRTLM.xcframework` from `Maelstrome/lora-wave-session-r32/native/ios/` on Hugging Face and verify its SHA256 before EAS builds.
- `react-native-litert-lm` declares `peerOptional expo@>=55.0.0`. We're on Expo 54. `.npmrc` sets `legacy-peer-deps=true` so installs proceed; keep that until the wrapper drops the constraint or the app moves to Expo 55.
- New Architecture (`newArchEnabled: true` in `app.json`) is required by Nitro Modules.

## Repo layout

```
mobile/
  app/                   Expo Router pages (will be replaced with src/screens/ wiring)
  src/
    runtime/             LiteRT (primary) and llama.rn (contingency) generator wrappers
    prompts/             Verbatim port of client/lib/prompts/
    gemma/               Verbatim port of client/lib/gemma/{chunk,session,insights,checkin}.ts
    voice/               VAD + STT + TTS + sentence-buffer + voice-turn-machine
    session/             Verbatim port of client/lib/session/
    screens/             RN screens (Intake / Safety / Chunk / CheckIn / Reflection / ModelDownload)
    components/          RN versions of NarrationCard, ScoreArc, NextStepChips, etc.
    types/               Verbatim port of client/types/
  assets/
    silero/              silero_vad.onnx (~2 MB, bundled)
```
