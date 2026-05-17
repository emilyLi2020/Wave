# Layer 2 — wrapper unit + Nitro compile (regression check)

**Verdict: ✅ PASS for every check runnable in a CLI-tools environment. No
regression — and none was expected: the WAVE verification changed _zero_
wrapper / native / TS source (only added the standalone `eval/` harness, a
README note, and `.gitignore` lines).**

Per issue #1 §6 Layer 2, run before any device build. This box is set up for
the litert-lm CLI / Node work, **not** full mobile native builds (no CocoaPods,
Command-Line-Tools only — no full Xcode, no Android SDK, JDK 11). The native
_compile_ steps are therefore environment-blocked, not code failures; they
recompile unchanged C++/Kotlin/Swift glue whose decisive validation is **Layer
3 on a real iPhone** (the issue's stated must-have device).

## Results matrix

| Step | Command | Result |
|---|---|---|
| Install (pkg) | `SKIP_IOS_FRAMEWORK_DOWNLOAD=1 npm install` | ✅ exit 0 |
| Install (example) | `cd example && SKIP_IOS_FRAMEWORK_DOWNLOAD=1 npm install` | ✅ exit 0 |
| **Nitro compile** | `npm run specs` (`npx nitrogen`) | ✅ exit 0 — `Generated 1/1 HybridObject`; created ios+android autolinking setup |
| **TS typecheck** | `npm run typecheck` (`tsc --noEmit`, `src/`) | ✅ exit 0 |
| **TS build** | `npm run build` (`tsc` → `lib/`) | ✅ exit 0 — `lib/` emitted |
| Unit tests | `bun test` | ⚠️ exit 0 but **0 tests** — repo has no test suite (nothing to regress; not introduced by this work) |
| Example typecheck | `cd example && npx tsc --noEmit` | ✅ exit 0 — `App.tsx` typechecks against the built package |
| Config plugin + autolink | `cd example && npx expo prebuild --clean --no-install` | ✅ exit 0 — `app.plugin.js` ran, `ios/` + `android/` generated; Podfile uses `use_native_modules!` / `use_expo_modules!` |
| Podspec lint | `pod lib lint …` | ⛔ BLOCKED — CocoaPods not installed |
| iOS sim build | `xcodebuild … -sdk iphonesimulator` | ⛔ BLOCKED — Command-Line-Tools only, no full Xcode |
| Android build | `./gradlew :assembleDebug` | ⛔ BLOCKED — no Android SDK; JDK 11 (< required 17+) |

The regression-relevant chain — the parts that would actually catch a breakage
from a source change (Nitro spec → TS typecheck → TS build → example typecheck
→ Expo config-plugin/autolink) — is **fully green**.

## ⚠️ Layer 3 prerequisite surfaced during install (action needed)

Installing triggered this fork's `scripts/postinstall.js`, which still targets
`hung-yueh/react-native-litert-lm@v0.3.7`:

```
https://github.com/hung-yueh/react-native-litert-lm/releases/download/v0.3.7/LiteRTLM-ios-frameworks.zip → HTTP 404
```

That is exactly the upstream regression in `hung-yueh#9`: the v0.3.7 GitHub
release is missing the iOS frameworks asset (v0.3.5 / v0.3.6 have it). I worked
around it for Layer 2 with `SKIP_IOS_FRAMEWORK_DOWNLOAD=1` (TS-only checks don't
need the frameworks), **but a real iOS device build for Layer 3 will hard-fail
on macOS** until one of these is done:

1. Pin/patch postinstall to a release that has the asset (v0.3.6), **or**
2. Build frameworks from source: `./scripts/build-ios-engine.sh` (needs full
   Xcode), **or**
3. Have this fork host its own `LiteRTLM-ios-frameworks.zip` and point
   `GITHUB_REPO` in `scripts/postinstall.js` at the fork.

This is independent of the WAVE bundle (which is verified working, Layer 1) —
it's a packaging blocker for *any* iOS build off this fork at the current
pinned version, and it's on the critical path to the 2026-05-18 demo.

### ✅ Fix applied (commit in this branch)

`scripts/postinstall.js` is rewritten to resolve frameworks from a prioritized
candidate list — `$LITERT_LM_FRAMEWORKS_URL` → `package.json`
`litertLm.iosFrameworks` → upstream `v{version}` release → known-good fallback
tags (`v0.3.6`/`v0.3.5`, same engine) — with **SHA-256 verification** when the
hash is known, clearer errors, and the upstream-#9 context inline.

`package.json` now declares `litertLm.iosFrameworks` pointing at the Wave
team's own HF-hosted build
(`…/native/ios/LiteRTLM-ios-frameworks.zip`, 67,312,757 B), pinned to the
**exact `artifactSha256` the team published** in their
`LiteRTLM-ios-frameworks-build-metadata.json`
(`bb5a16c8c6f73e7ca7e0e77dfaa59d9cc6c63415f984fc58ae5debd53dd7029f`) — that
build is LiteRT-LM `main@2f70ce8`, built via this repo's own
`scripts/build-ios-engine.sh` for `@0.3.6`, CPU-smoke-verified, and explicitly
"intended to replace the stale v0.10.2 framework".

Validated here: `node --check scripts/postinstall.js` ✅, `package.json` parses
✅, pinned SHA-256 == upstream-published SHA-256 ✅. The live download itself is
a supply-chain action gated to the user — run it (or a normal `npm install`
without `SKIP_IOS_FRAMEWORK_DOWNLOAD`) to populate `ios/Frameworks/`:

```bash
node scripts/postinstall.js   # downloads, SHA-256-verifies, extracts
```

## Next — Layer 3 (on-device, the must-have)

Resolve the iOS-frameworks prerequisite above, then add a "Run Wave eval suite"
path to `example/App.tsx`: `downloadModel` the bundle → `loadModel` →
`sendMessageAsync` over the 3 canonical prompts → reuse `eval/run.mjs` scoring
(or port the cosine gate) on-device. Needs full Xcode + a physical iPhone
(8 GB+, the issue's documented constraint).
