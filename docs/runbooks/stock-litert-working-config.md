# Runbook — Verified working stock Gemma 4 LiteRT config (WAVE)

> **🏆 Verified on a physical iPhone 17 Pro, 2026-05-16.** This is the
> reproducible snapshot of the *working* on-device LiteRT path. If you
> need "the thing that demonstrably runs," start here. Companion to
> `docs/postmortems/gemma4-litert-stock-limits-research.md` (the why) and
> [`Wave#14`](https://github.com/emilyLi2020/Wave/issues/14) (tracking).
> Do not delete.

## What this is

Stock (un-fine-tuned) Gemma 4 E2B running on-device through LiteRT-LM on
iPhone, via a one-line fork of `react-native-litert-lm` that splits the
conflated `maxTokens` knob. Proven: the full ~1846-token WAVE chunk-1
prompt streamed coherent JSON on device.

## Pinned artifacts (the "saved model")

| Piece | Exact value |
|---|---|
| Model bundle | `https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it.litertlm` (~2.59 GB, downloaded at runtime, cached) |
| Wrapper fork | `IdkwhatImD0ing/react-native-litert-lm-wave` @ **`f9dbf28`** — *pristine npm `0.3.6` + only the 5-file maxTokens patch* (NOT `d35ba92`, which bundled the `main` framework and broke the C++ bridge compile) |
| `mobile/package.json` dep | `"react-native-litert-lm": "github:IdkwhatImD0ing/react-native-litert-lm-wave#f9dbf28b7cf8b0afeb390a525a155dc37db4002e"` |
| Framework | upstream **v0.10.2** prebuilt, **committed inside the fork repo** at `f9dbf28` (`ios/Frameworks/LiteRTLM.xcframework`, built 2026-04-24). The fork's `postinstall.js` is a **no-op here** — it only downloads when `ios/Frameworks` is empty, and it isn't. So the binary in the `.app` is unambiguously the fork's committed v0.10.2 prebuilt; no HF rebuild artifact is wired on this branch. (The `mobile/scripts/install-litert-ios-framework.js` referenced in `docs/postmortems/litert-lm-mobile-finetune.md` does **not** exist on this branch — that provenance story is stale; see Wave#17.) The 0.3.6 C++ bridge only compiles against the v0.10.2 C header. |
| Engine config | `engineMaxTokens: 2048`, `outputMaxTokens: 256` — the litert-community **benchmark** values; verified-safe, NOT proven hard caps. Runtime-settable; real envelope under measurement in Wave#15 Phase 0. |
| System prompt (stock path) | Currently the canonical `WAVE_SYSTEM_PROMPT` (via `check-in.ts` / `chunk-generator.ts`), and a tiny inline prompt on the stock test screen. `WAVE_SYSTEM_PROMPT_STOCK_COMPACT` is **defined but not yet wired** — switching to it is Wave#15 Phase 0b. (When wired: stock base only — the fine-tune/GGUF path must keep canonical `WAVE_SYSTEM_PROMPT` verbatim.) |
| Verified device | iPhone 17 Pro, hardware UDID `00008150-001079E40182401C` |
| Branch | `wave/litert-maxtokens-pathA` |

> **⚠️ CORRECTION:** the "2048 total / 256 decode" framing below is
> over-stated (old-wrapper conflation artifact). Context is
> runtime-settable; real iOS ceiling ≈ 4096 ([LiteRT #6765]), and the
> 256-decode cap is unverified post-fork. The table is the *conservative
> verified-safe* envelope; the true envelope is being measured per
> `docs/plans/litert-cache-reexport-plan.md` Phase 0. Don't treat the ❌
> rows as proven.

## Per-surface fit — HISTORICAL estimate at the benchmark 2048/256 config

> This table is the conservative estimate **at the 2048/256 benchmark
> config only**, under the now-disproven `min(outputMaxTokens, 256, 2048 −
> input)` model. It is NOT the true envelope: context is runtime-settable
> and the 256/2048 numbers are not proven caps. The ⚠️/❌ rows are
> **unverified pending the Wave#15 Phase 0 sweep** (real WAVE prompts +
> tokenizer counts on device). Kept only to show why the sweep matters.

| Surface | Input (est) | Output need | At 2048/256 (historical estimate) |
|---|---|---|---|
| Reflection | ~700 | ~150–180 | ✅ fits |
| Check-in turn | ~600–1000 | <100 | ✅ fits |
| Chunk-1 / phase | ~1846 (→ ~1400 w/ compact) | ~150–210 | ✅ (tight at canonical) |
| Chunks 2–5 | ~2500–2900 w/ history | ~150–210 | ❓ unverified — the core Phase 0 question |
| >256-tok output | — | >256 | ❓ unverified (256-decode cap not re-tested post-fork) |

The compact system prompt reduces every chunk's input by ~400–500 tokens,
which *should* materially help chunk-1 and push chunks 2–5 lower — but by
how much, and whether chunks 4–5 / >256-token outputs then fit, is exactly
what **Wave#15 Phase 0 measures**. Do not treat "needs GGUF/re-export" as
settled; that conclusion was from the disproven 2048/256 model and is now
an open question pending the on-device sweep.

## Reproduce the on-device build (no EAS credits)

Full detail in memory `litert-fork-signing-setup`. Summary:

```
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
cd mobile && npm install                         # resolves fork @ f9dbf28; postinstall pulls v0.10.2 framework
npx expo prebuild                                 # generates mobile/ios/ (git-ignored, CNG)
# pods install during prebuild
# signing: eas credentials -p ios -> "Download credentials from EAS to credentials.json"
#   import credentials/ios/dist-cert.p12 into login keychain
#   copy credentials/ios/profile.mobileprovision -> ~/Library/Developer/Xcode/UserData/Provisioning Profiles/<UUID>.mobileprovision
xcodebuild -workspace <abs>/mobile/ios/Wave.xcworkspace -scheme Wave \
  -configuration Debug -destination 'generic/platform=iOS' \
  -derivedDataPath <abs>/mobile/ios/build/DD \
  CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM=8TADX8KSDK \
  PROVISIONING_PROFILE_SPECIFIER=<profile UUID> \
  CODE_SIGN_IDENTITY=<EAS dist cert SHA1> build
xcrun devicectl device install app --device <coredevice-id> \
  <abs>/mobile/ios/build/DD/Build/Products/Debug-iphoneos/Wave.app
npx expo start                                    # Metro; open Wave on device -> /tests/litert-stock
```

`credentials.json` + `credentials/` are git-ignored (private key). EAS was
abandoned for builds (out of credits); this local path is the supported one.

## Demo corner-cuts (Wave#15 — to fit stock LiteRT's 2048 budget)

Stock Gemma 4 on LiteRT can't hold the canonical system prompt + an
accumulating session history within the 2048-token compiled budget (the
phone demo hung/crashed on the heavy late chunks). For the **phone demo**
two deliberate corner-cuts were made; both are localized and reversible:

1. **Phase-narration history reduced to the last check-in only.**
   `chunk-generator.ts` `renderHistoryBlock` previously included up to
   `MAX_HISTORY_ENTRIES=10` recent entries (all prior chunk narrations +
   check-ins). Now chunk N includes **only the single immediately-prior
   check-in** (the one after chunk N−1); chunk 1 includes nothing (no
   prior check-in). Drops all chunk-narration history and older check-ins,
   capping the history block at ~one short check-in transcript instead of
   growing unbounded. **Trade-off:** later chunks lose long-range
   continuity (earlier obstacles, full score arc) and react only to the
   most recent check-in. Acceptable for the demo; revisit if a
   larger-context bundle ships.

2. **Chunk system prompt trimmed ~half.** The chunk-generator's appended
   "CHUNK NARRATION OUTPUT / formatting rules" block was condensed
   (~280 → ~140 tok). The canonical `WAVE_SYSTEM_PROMPT` is **not**
   touched (clinically gated: requires a clinician citation + LoRA
   retrain). Only the redundant formatting verbosity was cut — every
   safety line (never prescribe / dose / crisis) and the
   one-beat-per-element / strict-JSON constraints are preserved, and the
   user-prompt `<task>` block still restates the format rules.

Combined effect: late-session phase-narration input drops from
~2500–2900 tok toward the ~1300–1500 range.

## ✅ VERIFIED on device — full session fits stock LiteRT (2026-05-16)

Phase 0 sweep, **physical iPhone 17 Pro**, stock `gemma-4-E2B-it.litertlm`,
fork `f9dbf28`, **eng2048 / out512 / gpu**, with both corner-cuts above.
**7/7 surface×variant probes passed — all valid JSON, zero hangs/crashes:**

| Surface | Outcome | Out tok | tok/s | RAM |
|---|---|---|---|---|
| chunk1 / compact | ✅ ok | 123 | 4.0 | 2.10 GB |
| reflection / canonical | ✅ ok | 131 | 3.9 | 2.09 GB |
| chunk1 / canonical | ✅ ok | 123 | 4.0 | 2.12 GB |
| chunk3 / compact | ✅ ok | 110 | 3.3 | 2.12 GB |
| chunk3 / canonical | ✅ ok | 110 | 3.0 | 2.13 GB |
| chunk5 / compact | ✅ ok | 101 | 3.1 | 2.13 GB |
| chunk5 / canonical | ✅ ok | 101 | 3.1 | 2.13 GB |

Findings:
- **Fit:** entire session (5 phase narrations + reflection) fits eng2048
  with the corner-cuts — **even the canonical prompt fits**; the compact
  variant is optional margin, not required.
- **Output size:** real outputs are **101–131 tok**, well under 256 —
  `out256` is sufficient; `out512` is just headroom. (Settles the
  "256 too small" question: no.)
- **Memory/stability:** ~2.1 GB, never low-mem, **no hangs/crashes** at
  eng2048. (Every earlier crash was eng4096 cold-start — do NOT use
  eng4096 on this stack.)
- **Latency (the only remaining constraint):** ~3–4 tok/s → ~30–40 s to
  generate a surface (~100–130 tok), plus a one-time ~75 s model load.
  Mitigations: load the engine **once per session** (not per call);
  **pre-generate** the next chunk during the patient's check-in (model
  idle then). Workable for pre-rendered narration; not chat-speed.

**Shipping config:** stock Gemma 4 E2B + `engineMaxTokens: 2048` +
`outputMaxTokens: 256` (or 512 for margin) + both corner-cuts + persistent
per-session engine. This is the prize-eligible LiteRT demo running the
real WAVE surfaces.

## Known-good commits

- `362a806` Path A fork wiring · `ea790aa` react-native-fs peer dep ·
  `280be1f` pin `f9dbf28` · `19d8d98` verified-win docs ·
  `c1fc871` outputMaxTokens 200→256 · (this commit) compact prompt + runbook.
