# PhoneClaw CPU-first viability probe (issue #1)

A zero-wrapper-refactor test that answers **one** question:

> Does a **non-stubbed** LiteRT-LM engine (PhoneClaw's Bazel-linked
> `CLiteRTLM`, which carries the real HuggingFace tokenizer) run the **exact
> WAVE v3 `.litertlm` bundle** on iOS and produce **English WAVE JSON**?

This isolates engine/tokenizer/runtime viability from React Native, Nitro,
cache-naming, and the eval UI — exactly the de-risking step both GPT-5.5
reviews asked for (issue #1 comments 4469278011, 4469312580) before any
packaging port.

## Why this is the right first move

The on-device `EXC_BAD_ACCESS` in `HFTokenizer::Decode` is **self-inflicted**:
this repo's `scripts/build-ios-engine.sh` does a static `find *.o` + `libtool`
merge that can't resolve the HF-tokenizer Rust FFI, so it stubs it to
`nullptr`. PhoneClaw avoids that by construction — it lets Bazel link the
whole engine into `//c:libLiteRTLMEngine.dylib`, pulling the real tokenizer in
as a normal dependency. If this probe emits English WAVE JSON, the fix is to
port that packaging into the wrapper (and delete the stubs).

## CPU-first by design

`LiteRTLMEngine`'s initializer defaults are *exactly* the reviewer-prescribed
probe shape: `backend: "cpu"`, `visionBackend: nil`, `audioBackend: nil`. No
Metal, so it runs on the **iOS Simulator** — no physical device required for
this first signal. (GPU is a separate, later probe.)

## Run

```bash
cd probe
WAVE_MODEL_PATH=/abs/path/to/litert-lm-v3-model.litertlm ./run-probe.sh
#   …or, to fetch the ~2.56 GB v3 bundle automatically:
./run-probe.sh --download
```

`run-probe.sh` will: point `DEVELOPER_DIR` at full Xcode, copy the canonical
`eval/wave-prompts.json` / `wave-outputs.json` as fixtures, resolve the model
(default: the copy already in `scratch/litert-lm-v3/`), pick an
already-booted iOS Simulator if any, and `xcodebuild test`. SwiftPM resolves
the remote package **`github.com/kellyvv/PhoneClawEngine` @ 0.1.0** and
auto-downloads its checksum-pinned `CLiteRTLM` xcframework from the GitHub
Release — no monorepo clone, no git-lfs, no symlinks.

> **Lineage note.** PhoneClawEngine v0.1.0 (2026-04) is an *older* engine line
> than WAVE v3's validated **v0.10.2** host runner (and than the monorepo's
> `0b48e5a`). That is fine for the probe's question — *does a non-stubbed
> engine emit English WAVE JSON on iOS at all* — and the lineage-parity
> verdict is exactly the reported-not-gated overlap metric below.

## What it checks

The probe sends the **canonical `reflection` prompt** built identically to the
host eval (`eval/run.mjs:220` — `systemPrompt` trailing-trimmed + `\n\n` +
`userPrompt`), greedy (`temperature 0`), and:

- **gates** (test fails if any false): non-empty · English (no CJK — the
  earlier false-degradation signal was Chinese) · structurally valid WAVE
  reflection JSON (`insight` / `journalPromptQuestion` / `nextSteps.one..four`)
  · contains the numeric `endingIntensity`.
- **reports, does not gate**: lexical overlap vs the known host v3 reference
  output. Greedy decoding on a *different runtime lineage* (PhoneClaw baseline
  `0b48e5a` vs WAVE v3's validated v0.10.2) will differ — the printed
  `PROBE_RESULT::{…}` line + side-by-side text is what drives the verdict.

## Verdict → next step

| Result | Meaning | Action |
|---|---|---|
| gates pass, high overlap | non-stubbed engine works **and** lineage preserves WAVE v3 | port PhoneClaw's `cc_binary`-dylib + companion-framework packaging into the wrapper; delete `scripts/stubs/*` |
| gates pass, low overlap | engine/tokenizer fine, but `0b48e5a` lineage drifts the fine-tune | adopt the *same packaging technique*, rebuilt at the **v0.10.2** lineage |
| gates fail / no `PROBE_RESULT` | engine/tokenizer/runtime not viable as-is | inspect `.probe-xcodebuild.log`; reassess |

Nothing here is committed except the SwiftPM scaffold; the clone, the model,
and all symlinked binaries are git-ignored.
