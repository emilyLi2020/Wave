# Fine-tuned Gemma 4 on LiteRT-LM via React Native iOS: there is no public conversion–runtime pair that loads it

> Sibling to [`mediapipe-finetune.md`](./mediapipe-finetune.md) (the web-side
> story — same fine-tune, same underlying `LITERTLM` bundle format, different
> consumer). That doc covered why `@mediapipe/tasks-genai` won't read our
> bundle in the browser. This one covers why **no public React Native wrapper
> for LiteRT-LM will load any bundle we can build for the fine-tune on iOS**
> as of 2026-05-16. Both halves of the converter ↔ runtime pair are publicly
> shipped; neither combination accepts a fine-tuned Gemma 4 E2B from a
> reproducible recipe.
>
> Resulting state on 2026-05-16: three bundle variants (MediaPipe Model Maker
> output at 5.07 GB; `litert-torch 0.9.0` at 2.56 GB; `litert-torch-nightly
> 0.10.0.dev20260515` at 2.56 GB) all rejected at engine creation by
> `react-native-litert-lm@0.3.6`. Stock `litert-community/gemma-4-E2B-it.litertlm`
> from the same HF community account loads cleanly on the same wrapper, same
> device, same backend. The wrapper is fine. **Our problem is that the
> public converter cannot produce a bundle compatible with the public
> wrapper for Gemma 4** — Google ships a stock pair internally for marketing,
> but the recipe isn't in pip and the upstream wrapper hasn't kept pace with
> the C++ runtime's Gemma 4 format changes.

## TL;DR

| Bundle | Producer | Load result on `react-native-litert-lm@0.3.6` |
|---|---|---|
| `Maelstrome/lora-wave-session-r32/mediapipe/model.litertlm` (5.07 GB) | Google **MediaPipe Model Maker** (Colab) | ❌ "Failed to create LiteRT-LM engine. Tried backend 'gpu' and CPU fallback" |
| `litert-lm/model.litertlm` v1 (2.56 GB) | `litert-torch 0.9.0` (pip) | ❌ same error |
| `litert-lm-v2/model.litertlm` (2.56 GB) | `litert-torch-nightly 0.10.0.dev20260515` (pip) | ❌ same error |
| `litert-community/gemma-4-E2B-it.litertlm` (2.59 GB, Google rebuild 2026-05-05) | Google **internal tooling** (not pip) | ✅ loads, generates coherently |

| Alternative consumer | Verdict for our bundle |
|---|---|
| `expo-llm-mediapipe` 0.6.0 → MediaPipeTasksGenAI iOS SDK | ❌ "failed to initialize engine: invalid argument sentencepiece tokenizer is not found in the model" (SDK expects `.task` format with inline sentencepiece; LITERTLM container wraps tokenizer differently) |
| `react-native-llm-mediapipe` | Same underlying SDK — same expected failure |
| `mylovelycodes/LiteRTLM-Swift` (prebuilt xcframework, 2026-04-16, LiteRT-LM v0.10.2 era) | Untested; same era as `react-native-litert-lm@0.3.6` so expected same rejection |
| `mylovelycodes/LiteRTLM-Swift` rebuilt from source against LiteRT-LM main (post-v0.11.0) | **Untested**, requires macOS + Bazel + Xcode; only realistic remaining LiteRT path on iOS |

The conversion succeeded at every step. The merged PyTorch model generates correctly (verified on the box with three WAVE-style prompts, ~9.6 tok/s on CPU BF16, all on-template). The bundles have the right magic bytes. They're rejected because the **container metadata format moved between Google's internal tooling era (used to build the stock bundle that's been working since the wrapper was published) and the current `litert-torch` pip release that we have access to**.

## The decisive evidence

### Same wrapper, same device, same backend; bundle is the only variable

The smoke screen at `mobile/src/screens/LiteRTSmokeScreen.tsx` has two
load paths sharing the same `react-native-litert-lm` `createLLM` / `loadModel`
flow:

```ts
// Production path (commit 5288b28 baseline):
const llm = await preloadWaveLiteRT();    // → ensureModel('litert-wave') → loadModel(nativePath, { backend: 'gpu', ... })

// Diagnostic path (same commit, "Try Stock Gemma" button):
const llm = createLLM({ enableMemoryTracking: true });
await llm.loadModel(STOCK_GEMMA4_URL, { backend: 'gpu', ... });
```

Production path tapped on physical iPhone:
`"Failed to create LiteRT-LM engine. Tried backend 'gpu' and CPU fallback"`

Diagnostic path tapped immediately after, same launch of same app on same
device: stock `litert-community/gemma-4-E2B-it.litertlm` (2.59 GB) loads
without error, status → `ready`. Confirmed 2026-05-16.

This rules out: wrapper bug, device, Metal entitlement, network, cache layer,
permissions, the `file://` prefix issue (already fixed in commit `2b6fdc6`),
or any iOS-side configuration. The wrapper is healthy. The bundle is wrong.

### First 16 bytes match stock byte-for-byte

```
Stock litert-community bundle (loads):
    L   I   T   E   R   T   L   M 001  \0  \0  \0 005  \0  \0  \0
    4c 49 54 45 52 54 4c 4d 01 00 00 00 05 00 00 00

Our litert-torch 0.9.0 output (rejected):
    4c 49 54 45 52 54 4c 4d 01 00 00 00 05 00 00 00

Our litert-torch-nightly output (rejected):
    4c 49 54 45 52 54 4c 4d 01 00 00 00 05 00 00 00
```

Magic bytes + format-version byte 5 identical across all three. The
rejection happens deeper in the LITERTLM container parser — likely in
section metadata or model-type descriptor encoding.

### Newer converter version: ~10 KB of metadata diff, same rejection

v1 (`litert-torch 0.9.0`) vs v2 (`litert-torch-nightly 0.10.0.dev20260515`):
**361 differing bytes in the first 4KB**, first diff at offset 24
(`5002` vs `0003` — likely a length or version field). The remaining
2.56 GB is byte-identical: HF upload dedup only added 2.33 MB of new data
for the entire v2 push. So nightly's diff vs 0.9.0 is purely metadata-side
— and the older wrapper rejects both, identically.

### Gemma 4 metadata builder in `litert-torch` is explicitly unfinished

From `litert_torch/generative/export_hf/model_ext/metadata_builder.py`:

```python
elif model_config.model_type == 'gemma4':
    # TODO(weiyiw): Update Gemma4 metadata builder once builder is updated.
    return gemma3_metadata_builder.build_llm_metadata
```

Both `0.9.0` and `litert-torch-nightly 0.10.0.dev20260515` ship with this
TODO unresolved — Gemma 4 falls back to the Gemma 3 metadata builder. That
fallback is wrong in some structural way that the older `react-native-litert-lm`
C++ runtime rejects even though Google's stock-bundle build path (using
internal tooling that *has* a real Gemma 4 metadata builder) succeeds.

### The merged PyTorch model itself is healthy

Sanity test on the conversion host (Threadripper 3970X, BF16 CPU, 9.6 tok/s):

```
USER: I'm feeling anxious right now. What's one small thing I can do?
ASSISTANT: It sounds like you're going through a tough moment. Here is one
small, simple thing you can try right now:

**Take three slow, deep breaths.**

1. **Inhale slowly** through your nose for a count of four.
2. **Hold** your breath gently for a count of four.
3. **Exhale slowly** through your mouth for a count of six.
4. Repeat this three times.
```

Three prompts including a capability probe and two WAVE-style emotional
support prompts — all coherent, all on-brand for the fine-tune. So this is
a packaging failure, not a training failure.

## What the public record says

The picture is uniformly bad across community-side reports as of 2026-05-16:

- **[google-ai-edge/litert-torch#998 — "How to convert Gemma-4 safetensors model to LiteRT-LM format?"](https://github.com/google-ai-edge/litert-torch/issues/998)** — User `hpkim0512` reports that `pip install litert-torch==0.8.0` is too outdated and only the `main` branch has the Gemma 4 commits. After upgrading they get a bundle that exports. Then user `cmeka` chimes in: *"have you confirmed the exported litert model is actually working? exporting appears to work but it's crashing upon running for us in #994"*. User `blackhumantg`: *"Everything is the same, no matter what I tried, it didn't work."* Open, no fix.

- **[google-ai-edge/litert-torch#994 — "Gemma 3n E4B export to LiteRT-LM produces non-functional model (pad tokens on device)"](https://github.com/google-ai-edge/litert-torch/issues/994)** — User `Dokotela` (clinical SOAP-note app developer; near-identical use case to ours) runs the same export command we used (`-q dynamic_wi4_afp32 --externalize_embedder --use_jinja_template`) for Gemma 3n. Export succeeds. Loads on Android via `flutter_gemma`. Generates only `<pad>` tokens. Google's stock pre-exported bundle for the same model works on the same device. Different failure mode than ours (their engine accepts the bundle but model weights are wrong), same root cause: `litert-torch` Gemma export pipeline produces structurally-valid but runtime-incompatible bundles. Open, labeled `type:quantization`, `status:awaiting ai-edge-developer`.

- **[google-ai-edge/litert-torch#995 — "Add Gemma-4 support with LoRA export"](https://github.com/google-ai-edge/litert-torch/issues/995)** — Feature request explicitly asking for: (1) Gemma 4 support, (2) unifying the LoRA export pipeline, (3) macOS/Metal compatibility. Google staff `sourcelite` responds asking for diagnostic info; nothing landed. Open.

- **[google-ai-edge/gallery#557 — "Failed to create engine (LiteRT) error when loading Gemma-4-E4B-it"](https://github.com/google-ai-edge/gallery/issues/557)** — Same `"Failed to create engine"` message we hit, in Google's *own* reference iOS/Android app, on Galaxy S24/S25/S26, Pixel 7, etc. Google staff `dpknag` acknowledges, asks if the same happens with E2B. Even Google's own SDK has the failure mode in their own app. Open.

- **[HF litert-community/gemma-4-E2B-it-litert-lm discussion #7 — "How to convert Gemma-4 model to litertlm format?"](https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/discussions/7)** — Same unanswered question we had to answer ourselves: how do you convert a custom Gemma 4 fine-tune into a `.litertlm` bundle that actually loads? 6+ developers stacked, unresolved (cited in the [`mediapipe-finetune.md`](./mediapipe-finetune.md) postmortem for the parallel web-side case).

- **[HF litert-community/TranslateGemma-4B-IT discussion #1](https://huggingface.co/litert-community/TranslateGemma-4B-IT/discussions/1)** — Google staff (tylermullen), verbatim: *"The pre-converted models we have so far are '-web.task' format, which we don't have any fine-tuning notebooks or colabs for, and probably won't be able to make any time soon."* The web `.task` situation is dead by official admission. The mobile `.litertlm` situation is the same shape — Google publishes stock bundles built with internal tooling, the public converter doesn't reach parity.

- **[hung-yueh/react-native-litert-lm#9 — "0.3.7 release missing iOS frameworks asset"](https://github.com/hung-yueh/react-native-litert-lm/issues/9)** — The only React Native wrapper for LiteRT-LM. Latest npm release (0.3.7) is broken upstream — postinstall 404s on the iOS frameworks zip. Issue open 14+ days with zero maintainer activity. We're pinned at `0.3.6` (published 2026-04-25) with C++ libs from pre-v0.11.0. Single-maintainer project, effectively unmaintained for this issue.

**No third-party converter, no community-discovered flag, no workaround exists that produces a working fine-tuned Gemma 4 `.litertlm` from a public toolchain *and* a React Native wrapper that loads it as of 2026-05-16.** This mirrors the situation in [`mediapipe-finetune.md`](./mediapipe-finetune.md) on the browser side — the converter is public, the consumer is public, but the pair is broken.

## What we tried (timeline of 2026-05-16)

1. **Provisioned vast.ai Threadripper 3970X** (32C/64T, 251 GB RAM, RTX A4000 — unused; CPU host-only conversion). Cost ~$0.20 for the full session.
2. **Merged `Maelstrome/lora-wave-session-r32` LoRA into `unsloth/gemma-4-E2B-it` base** via PEFT `merge_and_unload`. ~30 s on Threadripper. Saved as 10.2 GB BF16 safetensors with tokenizer + chat template from the adapter.
3. **Converted via `litert-torch 0.9.0`** with `python -m litert_torch.generative.export_hf <merged> <output> --bundle_litert_lm=True --externalize_embedder=True --quantization_recipe=dynamic_wi4_afp32 --use_jinja_template=True --cache_length=4096 --prefill_lengths=[512,1024]`. Exported in 10.5 min. Output 2.56 GB. Pushed to `Maelstrome/lora-wave-session-r32/litert-lm/model.litertlm`.
4. **Flipped `mobile/src/runtime/model-cache.ts` `litert-wave` manifest** to new URL. Cache check now requires exact size match against `expectedBytes` (commit `eaa72ca`) so the old 5 GB bundle gets discarded automatically.
5. **Tested on iPhone via hot-reload** — same engine creation error as the original MediaPipe bundle.
6. **Re-installed `litert-torch-nightly 0.10.0.dev20260515`** (released 2026-05-15 — *after* the stock Gemma 4 rebuild on 2026-05-05). Re-exported with identical flags. Bundle is byte-deduped against v1 except ~10 KB of metadata.
7. **Pushed v2 to `Maelstrome/lora-wave-session-r32/litert-lm-v2/model.litertlm`**, flipped manifest to the v2 URL. Tested on iPhone. Same error.
8. **Confirmed stock-Gemma diagnostic still loads** on the same app — wrapper is healthy.
9. **Attempted local validation via `litert_lm_main` v0.11.0 Linux binary** to bypass the iOS round-trip cost. Binary needs `libGemmaModelConstraintProvider.so` from a Bazel runfiles tree that isn't shipped in the GitHub release. Dead end without building from source.
10. **Pivoted to `expo-llm-mediapipe` 0.6.0** (MediaPipe LLM Inference iOS SDK; sits on LiteRT, qualifies for the LiteRT-prize requirement). New manifest entry pointing at the existing MediaPipe-flavored bundle. EAS rebuild + install. Load fails with `"failed to initialize engine: invalid argument sentencepiece tokenizer is not found in the model"` — the deprecated MediaPipe LLM Inference SDK wants `.task` format with inline sentencepiece; our `LITERTLM` container wraps the tokenizer differently. Same trap, different SDK.

Total spend: ~$0.20 of vast.ai, ~1.5 EAS dev builds, ~3 hours wall-clock.

## Why we did not iterate further on this path

The MediaPipe browser postmortem ([`mediapipe-finetune.md`](./mediapipe-finetune.md))
made the same call for the same reason: there's no iteration surface. The
converter writes `LITERTLM` (and only `LITERTLM`); the wrapper we're stuck on
reads only an older `LITERTLM` schema variant; the alternative wrapper reads
only `.task` with inline sentencepiece. No flag exists in either side to
close the gap. Six more conversion runs with different
`--quantization_recipe` or `--cache_length` values would produce the same
structural rejection, because the gap isn't in the bytes we're choosing,
it's in the metadata builder the converter is using as a stopgap.

The one untried-but-realistic path is rebuilding
[`mylovelycodes/LiteRTLM-Swift`](https://github.com/mylovelycodes/LiteRTLM-Swift)'s
xcframework against LiteRT-LM main (post-v0.11.0, the May 7 release that
explicitly added Gemma 4 Multi-token Prediction support and likely changed
the bundle format on the runtime side too) and bridging that as an Expo
Module. That requires macOS + Bazel + Xcode + ~1-2 days. It has medium
certainty of working — the runtime is post-v0.11.0 so format-side parity is
plausible — but `litert-torch#994` (Dokotela's pad-token result on
Android with the equally-modern `flutter_gemma` runtime) suggests even
modern runtimes hit *runtime* corruption with `litert-torch`-built Gemma
bundles. We may unblock loading and then hit a generation bug. The expected
value of that work is positive but uncertain.

## Lesson

The cross-cutting lesson from this and [`mediapipe-finetune.md`](./mediapipe-finetune.md):
**when a vendor ships a converter and a consumer for the same format, verify
the loaded version of both halves are paired before you do any conversion
work — extension and magic bytes aren't enough**. The MediaPipe browser case
was "magic bytes look right; consumer parses different magic." This case is
"magic bytes look identical; consumer parses an older schema variant."
Either way, the only reliable signal is observing a *third-party-built*
bundle that the *exact wrapper version you have* successfully loads. We
had that signal early on (stock Gemma loads in `react-native-litert-lm@0.3.6`)
but it only certified the consumer side, not the converter side. The
converter–consumer pair is what you actually need to validate, end to end,
against a checkpoint you trained yourself.

This is already encoded as
`feedback_verify_vendor_pair_public` in the assistant's memory, written
after [`mediapipe-finetune.md`](./mediapipe-finetune.md). It bit us a
second time because we read it as "is the consumer public?" rather than
"can a public converter build something the public consumer accepts for the
specific architecture I trained on?" Rule now updated.

Operationally: if a vendor's stock model bundle for architecture X loads in
the consumer, but the public-pip converter has a `TODO` comment for
architecture X *and* zero issues marked closed for "Gemma-4 working
conversion," **the converter cannot reach the consumer for your architecture
yet, no matter what flags you pass**. Treat the TODO comment as a hard stop.

## What ships instead

Three options, ranked by effort-to-certainty ratio:

1. **Rebuild LiteRTLM-Swift xcframework against LiteRT-LM main, bridge as Expo Module** — 1-2 days on macOS. Closes the runtime-side version skew. Doesn't necessarily close the converter-side metadata gap (Dokotela's case suggests it might fail with pad-token generation). Highest hope; non-trivial work; useful even if it requires waiting for `litert-torch` to fix its Gemma 4 metadata builder.
2. **Use stock `litert-community/gemma-4-E2B-it.litertlm` via `react-native-litert-lm` with WAVE prompts injected at system-message scope** — works today, loses the fine-tune. Qualifies for the "uses LiteRT" prize requirement. ~1-2 h to wire.
3. **Fall back to `llama.rn` + GGUF** (the original contingency in the pivot plan). GGUF shards already on HF at `Maelstrome/lora-wave-session-r32/gguf/`. Keeps the fine-tune. ~3-4 h. Does not qualify for the LiteRT prize.

The hybrid path — stock Gemma via LiteRT for the prize-qualifying demo, plus
llama.rn + GGUF for the production-quality flow that uses the fine-tune —
is the highest-EV option for the hackathon timeline if option 1 doesn't
complete in time.

## File references

- **The fine-tune (works correctly in PyTorch)**: `Maelstrome/lora-wave-session-r32` (LoRA adapter) + `unsloth/gemma-4-E2B-it` base
- **The three bundles we built (all rejected)**: `Maelstrome/lora-wave-session-r32/{mediapipe,litert-lm,litert-lm-v2}/model.litertlm`
- **The stock bundle that loads**: `litert-community/gemma-4-E2B-it.litertlm`
- **The wrapper we're pinned to**: `react-native-litert-lm@0.3.6` (`mobile/.npmrc`'s `legacy-peer-deps=true`)
- **The mobile entry point**: `mobile/src/runtime/litert-generators.ts`, `mobile/src/runtime/mediapipe-generators.ts` (parallel path also blocked)
- **The smoke screens**: `mobile/src/screens/{LiteRTSmokeScreen,MediaPipeSmokeScreen}.tsx`
- **Cache layer with exact-size invalidation**: `mobile/src/runtime/model-cache.ts`
- **Sibling postmortem (browser-side parallel)**: [`mediapipe-finetune.md`](./mediapipe-finetune.md)
- **Cross-cutting iOS browser ceiling**: [`ios-safari-browser.md`](./ios-safari-browser.md)
- **Plan with full hardware allocation + contingency table**: `~/.claude/plans/take-a-look-at-fizzy-melody.md`
- **The branch this work lives on**: `pivot/react-native-litert`
- **Issue tracking**: [`Wave#11`](https://github.com/emilyLi2020/Wave/issues/11) (now marked resolved-with-caveat — the LITERTLM-flavored re-export *was* delivered as Issue #12's runbook asked, but the resulting bundle still doesn't load due to converter–wrapper version skew, not bundle flavor)
