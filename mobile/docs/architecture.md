# mobile/ architecture

How the Wave React Native iOS app is wired. Companion to the pivot plan at
`~/.claude/plans/take-a-look-at-fizzy-melody.md` and the original tracking
issue at `docs/issues/react-native-pivot.md`.

## Why this app exists

`client/` (the Next.js web app) runs the Gemma 4 WAVE fine-tune in the
browser via wllama. iOS Safari aborts model load with `TypeError: Conversion
from BigInt to number is not allowed` because wllama 3.x's WASM build needs
the Memory64 proposal that WebKit does not implement (full evidence in
`../../docs/postmortems/ios-safari-browser.md`). For a medical hackathon
that disallows cloud inference, the iOS path has to be native.

This app reuses the existing fine-tune verbatim. Same prompts. Same Zod
schemas. Same session reducer. Only the runtime layer, the audio I/O, and
the UI shell are new.

## Stack

| Layer | Library | Hardware target |
|---|---|---|
| LLM (primary) | `react-native-litert-lm` 0.3.6 (Nitro Modules) + rebuilt LiteRT-LM iOS XCFramework | Metal GPU |
| LLM (contingency) | `llama.rn` (not yet installed) | Metal GPU |
| STT | `whisper.rn` 0.6.0 | Metal GPU initially; CoreML ANE encoder is a follow-up |
| TTS | `react-native-sherpa-onnx` 0.4.3 (Kokoro 82M) | ANE via CoreML EP |
| VAD | `onnxruntime-react-native` 1.24.3 + bundled Silero v5 ONNX | CPU |
| Framework | Expo SDK 54 + Expo Router 6 + Reanimated | — |

New Architecture (`newArchEnabled: true` in `app.json`) is required by Nitro.

The "no two simultaneously-active components target the same processor"
constraint from the plan is what motivates this allocation. See the
"Hardware allocation" section of the plan file for the turn timeline.

## Directory layout

```
mobile/
├── app/                          Expo Router routes (file-based)
│   ├── _layout.tsx               Root Stack
│   ├── index.tsx                 Dev menu (home)
│   ├── tests/
│   │   ├── _layout.tsx           Tests stack
│   │   ├── litert.tsx            → LiteRTSmokeScreen
│   │   ├── whisper.tsx           → WhisperTestScreen
│   │   ├── kokoro.tsx            → KokoroTestScreen
│   │   └── combined.tsx          → CombinedVoiceTestScreen (stub for now)
│   └── session/
│       ├── _layout.tsx           Session stack
│       └── {intake,safety,chunk,checkin,reflection}.tsx  Skeletons
│
├── src/                          All source code; tsconfig @/* points here
│   ├── runtime/
│   │   ├── types.ts              ChatRuntime contract types
│   │   ├── litert-generators.ts  Primary runtime — same exports as
│   │   │                         client/lib/gemma/wllama-generators.ts
│   │   ├── llamarn-generators.ts (not yet implemented; contingency only)
│   │   └── model-cache.ts        Unified download/cache for all artifacts
│   ├── prompts/                  Verbatim port of client/lib/prompts/
│   │                             (chunk-generator, check-in, reflection,
│   │                              insights, fallback-bank, schemas,
│   │                              wave-system, obstacle-library,
│   │                              check-in-openers, mat-missed-dose-reference,
│   │                              check-in-dialogue [from client/lib/training/])
│   ├── gemma/                    Verbatim port of client/lib/gemma/
│   │                             {chunk,session,insights,checkin}.ts
│   │                             with ONE import-line change each pointing
│   │                             at @/runtime/litert-generators
│   ├── voice/                    (empty — populated in step 5)
│   ├── session/
│   │   ├── session-machine.ts    Reducer extracted from
│   │   │                         client/app/session/_components/
│   │   │                         session-machine.tsx (pure TS, no React)
│   │   ├── is-affirmative.ts     Verbatim port
│   │   ├── score-tracking.ts     Verbatim port
│   │   └── extract-craving-score.ts  Verbatim port
│   ├── screens/
│   │   ├── LiteRTSmokeScreen.tsx
│   │   ├── WhisperTestScreen.tsx
│   │   ├── KokoroTestScreen.tsx
│   │   ├── CombinedVoiceTestScreen.tsx
│   │   └── CachePanel.tsx        Embedded in app/index.tsx
│   └── types/                    Verbatim port of client/types/
│
├── assets/
│   ├── images/                   From scaffold
│   ├── silero/                   Silero VAD ONNX — bundled, ~2 MB (step 5a)
│   └── kokoro/                   Gitignored; populated by
│                                 scripts/download-kokoro.sh (~330 MB)
│
├── scripts/
│   ├── download-kokoro.sh        One-shot fetch+extract of Kokoro bundle
│   ├── install-litert-ios-framework.js
│   │                            Downloads the rebuilt LiteRT-LM iOS
│   │                            XCFramework from HF after npm install
│   └── reset-project.js          From scaffold
│
├── docs/
│   ├── architecture.md           ← this file
│   └── handoff.md                Onboarding for a new contributor
│
├── app.json                      Expo config: entitlement, plugins, perms
├── eas.json                      EAS Build profiles for iOS
├── package.json                  Deps + scripts
├── tsconfig.json                 Path aliases (see "Module resolution" below)
└── .npmrc                        legacy-peer-deps=true (required for
                                  react-native-litert-lm + Expo 54)
```

## Native LiteRT-LM Framework

`react-native-litert-lm@0.3.6` is the pinned wrapper, but its original iOS
framework was built from an older LiteRT-LM runtime that rejected WAVE's
Gemma 4 LiteRT-LM bundles at engine creation. The app replaces that framework
after install:

```
npm install
  → scripts/install-litert-ios-framework.js
      → downloads Maelstrome/lora-wave-session-r32/native/ios/LiteRTLM-ios-frameworks.zip
      → verifies byte size + SHA256
      → extracts to node_modules/react-native-litert-lm/ios/Frameworks/
```

The HF artifact was built from `google-ai-edge/LiteRT-LM` `main` commit
`2f70ce879d1dd4c4a22e597b2c0a03f9799fef7d` with the wrapper's
`scripts/build-ios-engine.sh`, which stubs the Rust / llguidance constrained
decoding pieces for iOS. Local macOS CLI verification used the same current
runtime with FST constraints disabled and loaded
`litert-lm-v3/model.litertlm` successfully on CPU; physical iPhone Metal
validation still happens through `/tests/litert`.

## The port boundary

The plan calls this out explicitly: the production check-in code path on web
isolates the runtime in `client/lib/gemma/wllama-generators.ts`. Everything
above it (`lib/gemma/{chunk,session,insights,checkin}.ts`, `lib/prompts/*`,
the session reducer) is runtime-agnostic.

That means the port is "swap one file" rather than "rewrite the stack":

```
session screens
  → src/gemma/{chunk,session,insights,checkin}.ts  (port verbatim,
                                                     one import line each)
      → src/runtime/litert-generators.ts            (new, primary)
          ▶ exports: generateWllamaChunk, generateWllamaReflection,
                     generateWllamaInsights, generateWllamaCheckIn
          ▶ same signatures as client/lib/gemma/wllama-generators.ts
          → react-native-litert-lm.createLLM
      OR  src/runtime/llamarn-generators.ts         (contingency, on hold)
          ▶ same exports, llama.rn under the hood, GGUF instead of LITERTLM
```

If the LiteRT smoke fails on a physical iPhone, the contingency is
implementing `llamarn-generators.ts` and changing one import line in each of
the four files in `src/gemma/`. No other code in the app cares.

### Why generators have `wllama` in their names

The four entry points are still named `generateWllamaChunk` etc. even
though wllama isn't running. We kept the name so the gemma wrappers port
verbatim from web — only ONE import line per file changed. Renaming the
exports would require editing the call sites too. Future cleanup item:
rename to `generateGemmaChunk` everywhere if the codebase consolidates.

## Runtime contract

`react-native-litert-lm` is a Nitro Module (JSI-bound) wrapping the
LiteRT-LM C++ engine. Key facts that shape `litert-generators.ts`:

- **No `response_format` / grammar config.** Unlike llama.cpp's wllama,
  there's no engine-level JSON-schema enforcement. We rely on the existing
  `<output_contract>` prompt blocks + `extractFirstJsonObject` +
  `parseCheckInJson` + Zod validation at the call site. This is the
  plan's "case 2" of the JSON-output trichotomy.

- **No system-prompt-per-call.** `LLMConfig.systemPrompt` is a load-time
  option. Each WAVE flow has its own composed system prompt
  (WAVE_SYSTEM_PROMPT + flow-specific additions), so we load the model
  with NO system prompt and pass the full composed prompt as one user
  message after `resetConversation()`. Sub-optimal vs. proper system/user
  separation, but works for the fine-tune (verify in smoke).

- **Streaming via callback.** `sendMessageAsync(message, (token, done) =>
  ...)` streams token-by-token. No `AbortSignal` parameter — aborting
  from JS stops the accumulator but the native generator keeps running
  until done. For barge-in (step 5c), the workaround is either calling
  `wrapper.close()` and reloading, or upstreaming a cancel PR.

- **Multi-turn state inside the wrapper.** `getHistory()` /
  `resetConversation()` manage history. There's no `setHistory(turns)`
  to inject prior turns. For the check-in flow we serialize history into a
  flat user message and reset before each call — re-prefills the prompt
  every call (slower at higher turn counts) but matches wllama semantics.

- **Built-in download + memory tracking.** `loadModel(url, config, onProgress)`
  auto-downloads HTTPS URLs into iOS `Library/Caches/litert_models/`.
  **We bypass this** to keep all downloads in the unified cache layer —
  call `ensureModel('litert-wave')` first, then pass the local path to
  `loadModel(localPath, config)`. `getMemoryUsage()` returns RSS / native
  heap / available memory; the smoke screen polls it.

See `src/runtime/litert-generators.ts` header comment for the full
strategy notes including the streaming + JSON-schema tension and tool-call
fallback for the check-in flow.

## Model cache

`src/runtime/model-cache.ts` is the single registry for downloaded model
artifacts. Each model has a manifest entry:

```ts
{
  id: 'litert-wave',
  label: 'Gemma 4 LITERTLM (WAVE fine-tune)',
  filename: 'model.litertlm',
  url: 'https://huggingface.co/.../model.litertlm',
  expectedBytes: 2_560_966_656,  // exact byte-size of the on-HF blob
  minBytes:      2_500_000_000,  // lower bound for the post-download truncation guard
}
```

Public API:

- `ensureModel(id, { onProgress, signal, force })` — idempotent: returns
  cached path on hit, downloads on miss. `force: true` re-downloads. Throws
  if the resulting file is smaller than `minBytes` (guards against
  truncated downloads).
- `inspectCache()` — array of `CacheEntry` with cached/missing flags.
- `clearModel(id)` / `clearAllModels()` — eviction.
- `formatBytes(n)` — helper for the cache panel UI.

Storage layout:

```
documentDirectory/
  wave-models/
    litert-wave/model.litertlm     (~2.4 GB)
    whisper-tiny-en/ggml-tiny.en.bin  (~78 MB)
```

`documentDirectory` was chosen so iOS doesn't reclaim the LiteRT bundle
under storage pressure (a 2.4 GB redownload is painful on cellular).
**Trade-off:** Documents/ is iCloud-backed by default. For a 2.4 GB model
that's wasteful for users. Polish item flagged in the source: either move
to `Library/Application Support/` (durable + not backed up) or set
`NSURLIsExcludedFromBackupKey` on the file once expo-file-system exposes
the flag.

### Models that don't go through the cache

- **Kokoro** is shipped as an Expo asset bundle at `mobile/assets/kokoro/`,
  populated by `scripts/download-kokoro.sh` once per dev machine. EAS Build
  packages the directory into the IPA. sherpa-onnx loads it via
  `{ modelPath: { type: 'asset', path: 'kokoro' } }`. Bundling is the
  right call because Kokoro is small enough (~330 MB) that the install
  size is acceptable for a TestFlight dev build and the runtime download +
  unzip pipeline isn't worth the complexity.

- **Silero VAD** ships bundled at `mobile/assets/silero/silero_vad.onnx`
  (~2 MB). Step 5a populates the file.

The unified cache is just for the things big enough to need on-demand
fetching (LiteRT) or things with no good bundle path (Whisper ggml).

### Cache panel UI

`src/screens/CachePanel.tsx` is embedded at the bottom of `app/index.tsx`
(the dev menu home). Per-model: cached/missing badge, on-disk size vs.
expected, Download / Re-download / Clear buttons, "Clear all caches"
footer. Polls `inspectCache()` after every action.

## Routing

Routes are file-based via Expo Router 6 (`typedRoutes: true` in
`app.json`).

```
/                            Dev menu (app/index.tsx)
  ├ /tests/litert            LiteRT smoke (download → load → generate → Zod)
  ├ /tests/whisper           Mic → whisper.rn → transcript
  ├ /tests/kokoro            Text → sherpa-onnx Kokoro → audio
  ├ /tests/combined          Integrated voice loop (currently a stub)
  └ /session/intake → /safety → /chunk → /checkin → /reflection
                                                       (skeletons)
```

The dev menu shows each entry with a `ready` / `wip` / `stub` badge so the
state of every route is visible at a glance. Below the route list sits the
cache panel.

After step 6 polish, the dev menu either becomes the production landing
("Start session") or stays behind a dev-build flag. For the hackathon
demo, the test pages are reachable to demonstrate each subsystem
independently.

## Module resolution

`tsconfig.json` uses a hybrid alias map so all `@/lib/...`-style imports
that came from `client/` resolve to the new `mobile/src/` layout verbatim:

```jsonc
"paths": {
  "@/lib/prompts/*":  ["./src/prompts/*"],
  "@/lib/session/*":  ["./src/session/*"],
  "@/lib/training/*": ["./src/prompts/*"],   // check-in-dialogue lives here now
  "@/lib/voice/*":    ["./src/voice/*"],
  "@/lib/gemma/*":    ["./src/gemma/*"],
  "@/lib/wllama/*":   ["./src/runtime/*"],
  "@/types/*":        ["./src/types/*"],
  "@/*":              ["./src/*", "./*"],     // src first, then root
  "whisper.rn":       ["./node_modules/whisper.rn/lib/typescript/index.d.ts"]
}
```

The `whisper.rn` alias is a workaround: that package's `exports` map
lacks a `"."` entry, which breaks bundler-mode TS resolution. Without the
alias, `import { initWhisper } from "whisper.rn"` fails type-check.

The `@/*` fallback to `./*` keeps any scaffolded boilerplate components
working (e.g. `@/hooks/use-color-scheme`) even though we put new code under
`./src/*`.

## Build workflow

Windows host means **all iOS builds are EAS cloud builds**. There's no
local Xcode. Native-code change → ~10-15 min EAS round trip. JS-only
change → hot-reload via `npx expo start --dev-client`.

```bash
# Once: register your iPhone
eas device:create

# Per native-code change: cloud build
eas build --profile development --platform ios

# Per JS change: dev server (after the IPA is installed)
npx expo start --dev-client
```

`eas.json` has four profiles:
- `development` — physical device, internal distribution, dev client.
- `development-simulator` — Simulator builds for UI work pre-Apple-Dev
  approval. CoreML / LiteRT GPU paths won't run here.
- `preview` — internal distribution, no dev client.
- `production` — auto-increment, App Store-ready.

## User-side critical path

These steps are not automatable from the agent:

1. **Apple Developer Program enrollment** (~$99/yr, 24-48h approval).
   Required for `com.apple.developer.kernel.increased-memory-limit`
   without which iOS kills the process at ~1.5 GB resident.
2. `npm i -g eas-cli && eas login`.
3. `eas device:create` — registers your iPhone UDID.
4. `eas build --profile development --platform ios` — first cloud build.
5. Install the IPA on the device (TestFlight or ad-hoc QR).
6. `npx expo start --dev-client` to attach the dev server.

`mobile/app.json` ships a placeholder bundle identifier (`com.wave.mobile`).
Update if you need a non-placeholder for your Apple team.

## Known constraints / TODOs

- **Memory budget is right at the iPhone 15/16 Pro ceiling.** ~5.35 GB
  resident with LiteRT (4.7) + Whisper (80M) + Kokoro (330M) + Silero (2M)
  + JS engine (~250M). iPhone 14 Pro and earlier (6 GB total RAM) won't
  fit. Mitigations if measured RSS crosses the line: smaller Whisper quant,
  Kokoro on CPU, or fall back to the llama.rn contingency (Q4_K_M GGUF is
  ~1.5 GB smaller than LITERTLM).

- **`documentDirectory` is iCloud-backed.** The 2.4 GB LiteRT bundle will
  back up by default. Fix: `NSURLIsExcludedFromBackupKey` or
  `Library/Application Support/`. Polish item.

- **whisper.rn CoreML encoder not yet wired.** Plain ggml on Metal is what
  the Whisper test page uses today. CoreML requires bundling a separate
  encoder model directory (weights/weight.bin, model.mil, coremldata.bin)
  via require(). Move the encoder to ANE in a follow-up to free Metal for
  Gemma + Whisper decoder.

- **sendMessageAsync has no AbortSignal.** Barge-in cancel needs either
  `wrapper.close()` + reload or an upstream PR. Choice deferred to the
  combined-loop wiring.

- **react-native-litert-lm peer dep mismatch.** Package declares
  `peerOptional expo@>=55.0.0`; we're on Expo 54. `.npmrc` enables
  `legacy-peer-deps=true` so installs proceed. If a runtime issue surfaces
  on EAS, the fix is bumping Expo or downgrading the wrapper.

## Where to look in the source

- Plan + reasoning: `~/.claude/plans/take-a-look-at-fizzy-melody.md`
- Original GitHub issue: `docs/issues/react-native-pivot.md`
- iOS Safari postmortem: `docs/postmortems/ios-safari-browser.md`
- MediaPipe postmortem: `docs/postmortems/mediapipe-finetune.md` (the
  reason the LITERTLM bundle was looking for a consumer)
- Web app the port came from: `client/`
- Vendor source clone (pre-flight grep): `.tmp/pivot-research/`
