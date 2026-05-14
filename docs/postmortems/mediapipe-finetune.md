# Fine-tuned Gemma 4 on MediaPipe in the browser: there is no public conversion path

> Sibling to [`onnx-finetune.md`](./onnx-finetune.md) (7 ONNX iterations, all `len=0` on browser WebGPU due to `onnxruntime-web` fp16 overflow) and [`mlc-finetune.md`](./mlc-finetune.md) (MLC PR #3485 build, works for first prompt, KV cache leaks between calls). MediaPipe / LiteRT-LM was the third pivot — supposed to be the clean exit from `onnxruntime-web`'s fp16 bug. This doc covers why it dead-ended too.
>
> Resulting state on 2026-05-14: the Mac conversion produced a structurally valid 4.7 GB `LITERTLM`-container bundle. The bundle is mobile-shippable. **No version of `@mediapipe/tasks-genai` reads it.** No public Google tooling converts a fine-tuned Gemma 4 to the `TFL3`-magic `.task` format that the browser SDK accepts. Google staff confirmed on the record that the recipe is internal-only and "probably won't" be released soon. We did not write seven export iterations this time — there was nothing to iterate against. Web-shipping route for the fine-tune is now wllama/GGUF.

## TL;DR

| Path | Status |
|---|---|
| Train Gemma 4 LoRA (Unsloth) | ✅ adapter at `Maelstrome/lora-wave-session-r32` |
| Merge LoRA via PEFT | ✅ produces coherent fp16 base |
| Convert on Mac via `litert-torch export_hf` (per [`mediapipe-mac-conversion.md`](../mediapipe-mac-conversion.md)) | ✅ emits `mediapipe/model.litertlm` (4.7 GB) |
| Load via `@mediapipe/tasks-genai` in the browser | ❌ `Error: No model format matched.` — both stable `0.10.27` and nightly `0.10.36-rc.20260514` |
| Load via any other browser/JS consumer | ❌ none exists for `LITERTLM` |
| Run on mobile (Android/iOS) via LiteRT-LM | ✅ in principle, untested — not our target surface |

The Mac-side conversion doc predicted `TFL3`-magic output at 1.5–2.5 GB. What we got: `LITERTLM`-magic at 4.7 GB. Neither the doc nor the converter `--help` mentioned that `litert-torch export_hf` had switched output formats; we discovered this only after the bundle failed to load in the browser.

## The decisive evidence

### What's in the file we produced

```
$ xxd -l 64 model.litertlm
00000000: 4c49 5445 5254 4c4d 0100 0000 0500 0000  LITERTLM........
00000010: 0000 0000 0000 0000 0003 0000 0000 0000  ................
...
```

Magic bytes `LITERTLM` at offset 0. Compare to the working base model that this page tests against:

```
$ xxd -l 64 gemma-4-E2B-it-web.task
00000000: 1c00 0000 5446 4c33 0000 1200 1400 0400  ....TFL3........
00000010: 0000 0800 0000 0c00 0000 1000 1200 0000  ................
```

`TFL3` at offset 4 — raw TFLite Flatbuffer, not even a ZIP-wrapped legacy `.task`. The base "task" file is actually just bare TFLite with extension `.task`. The new converter emits a different, wrapping container.

### What `@mediapipe/tasks-genai` actually parses

Grep both bundle versions on jsdelivr:

```
$ grep -oE "(LITERTLM|TFL3)" /tmp/genai-stable.mjs | sort -u
TFL3
$ grep -oE "(LITERTLM|TFL3)" /tmp/genai-nightly.mjs | sort -u
TFL3
```

Only one matcher registered, in both stable `0.10.27` and nightly `0.10.36-rc.20260514`. The error in the browser:

```
Error: No model format matched.
    at genai_bundle.mjs:1:53616
    at async ri.N (genai_bundle.mjs:1:53448)
    at async genai_bundle.mjs:1:35661
```

Source of the throw, from the nightly bundle:

```js
if(0===r.length)throw Error("No model format matched.");
```

— `r` is the list of format matchers that accepted the file. `LITERTLM`-magic matches zero of them. The dispatch is in **JS**, not WASM, so swapping the WASM URL has no effect. Confirmed.

### What we tried before giving up

1. **Rename `.litertlm` → `.task` on disk via hardlink** — same bytes, different extension. Loader's content-sniff rejects it identically.
2. **Pin both WASM and JS bundle to nightly `0.10.36-rc.20260514`** (released the day of this work). Loader still throws — same error, slightly different bundle offset. Confirmed grep above; nightly hasn't added LITERTLM support either.
3. **Inspected the JS for any opt-in flag** that might enable a `LITERTLM` path — `LlmInference.createFromOptions`, `FilesetResolver.forGenAiTasks`, the `BaseOptions` type. No undocumented flag exists.
4. **Inspected the `litert-torch export_hf` CLI surface** indirectly via Google's [`/edge/litert-lm/cli`](https://ai.google.dev/edge/litert-lm/cli) docs. No `--output_format=task` / `--web` / `--no_externalize_embedder` flag is documented. `--externalize_embedder` (which we used per the conversion doc) is the closest to a format switch, but dropping it is untested and uncertain to fix the magic-bytes mismatch — the LITERTLM container is now the converter's default output, not a side-effect of one flag.

## What the public record says

Researched community-side reports across GitHub, HF, Stack Overflow, Reddit, Discord scrapes (see [issue #8](https://github.com/emilyLi2020/Wave/issues/8) for sources). The picture is consistent across ~10 threads:

- **[google-ai-edge/LiteRT-LM #2150](https://github.com/google-ai-edge/LiteRT-LM/issues/2150)** — different developer, same `tasks-genai@0.10.27` `TFL3`-only matcher, same blocker on `.litertlm` files. Cites [`mediapipe/tasks/web/genai/llm_inference/model_loading_utils.ts#L158`](https://github.com/google-ai-edge/mediapipe/blob/01630613ec7a31e1420b6531bff671523afe1de4/mediapipe/tasks/web/genai/llm_inference/model_loading_utils.ts#L158) as the load-time gate. Google staff: *"It's definitely something we're looking into."* Still open.
- **[HF litert-community/gemma-4-E2B-it-litert-lm discussion #7](https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/discussions/7)** — 6+ developers stacked asking how to fine-tune the web `.task`. The MediaPipe `convert_checkpoint` path everyone tries fails with `ValueError: Unknown special model: GEMMA_4_E2B`. Thread unresolved.
- **[HF litert-community/TranslateGemma-4B-IT discussion #1](https://huggingface.co/litert-community/TranslateGemma-4B-IT/discussions/1)** — Google staff (tylermullen) confirms the gap verbatim:
  > "The pre-converted models we have so far are '-web.task' format, which we don't have any fine-tuning notebooks or colabs for, and probably won't be able to make any time soon. Note that most of the documentation on our website for model conversion will point you to a different converter which will not work for this purpose."
- **[google-ai-edge/litert-torch #998](https://github.com/google-ai-edge/litert-torch/issues/998)** — even the mobile-side Gemma 4 export from `litert-torch` is shipping with bugs: wrong KV-cache dtype, wrong mask dtype, missing `param_tensor` field, missing `verify` signature, uses `GenericDataProcessor` instead of `Gemma4DataProcessor`. QuadraKev worked around it by binary-patching the prebuilt `LITERTLM` with their fine-tuned TFLite sections (not a sustainable recipe).
- **[google-ai-edge/litert-torch #1005](https://github.com/google-ai-edge/litert-torch/issues/1005)** — `litert_lm_builder.py` literally missing the `case 'gemma4':` arm.
- **[google-ai-edge/mediapipe #6270](https://github.com/google-ai-edge/mediapipe/issues/6270)** — even Google's own prebuilt `gemma-4-E2B-it-web.task` (the base file we use) crashes on Apple M4 Macs. Their own artifact is not robust.

No Stack Overflow, Reddit, or dev.to result addresses this gap meaningfully. The conversation is concentrated entirely in google-ai-edge GitHub and HF litert-community discussions. **No third-party converter, no community-discovered flag, no workaround exists that produces a working fine-tuned Gemma 4 `-web.task` from a public toolchain as of May 2026.**

## The conversion command we ran (for reference)

Per [`mediapipe-mac-conversion.md`](../mediapipe-mac-conversion.md) Step 3, on a Mac with `litert-torch-nightly==0.10.0.dev20260514`:

```bash
litert-torch export_hf \
  --model=models/runs/merge-peft \
  --output_dir=models/runs/litertlm-finetune \
  --externalize_embedder \
  --jinja_chat_template_override=litert-community/gemma-4-E2B-it-litert-lm
```

Output: `model.litertlm` (4.7 GB), uploaded to `Maelstrome/lora-wave-session-r32` under the `mediapipe/` subdirectory alongside `wave-prompts.json` and `wave-outputs.json` (Python-runtime ground truth for the three WAVE prompts).

The Python-runtime ground truth confirms the underlying fine-tune is healthy: phase 223 tokens of on-template body-scan prose, check-in 73 tokens ending with the expected question mark, reflection 112 tokens of JSON (with the known outer-`}` defect — string ends at the `nextSteps` inner close-brace). So the **model** is fine. Only the **browser packaging** is dead.

## Why we did not iterate

The ONNX postmortem cataloged seven export iterations because every iteration killed one overflow site and we could measure progress on Node-CPU (coherent) vs browser-WebGPU (`len=0`). Iteration was diagnostically productive even when the bug was unfixable.

This case has no iteration surface. There is no overflow to chase, no kernel to rewrite. The bug is structural: the bytes we produce aren't a format any browser SDK reads. Six more conversion runs with different flag permutations would still produce a container with no consumer. The Google-staff statement makes it explicit — the recipe is internal-only and not coming soon.

## Lesson

When a runtime path depends on a converter–consumer pair maintained by the same vendor, **verify that both halves of the pair are public before doing the conversion work.** The MediaPipe browser SDK is public and we'd been validating against it for the base model; the LITERTLM-emitting converter is public; but the SDK doesn't read what the converter writes. We executed the documented command, got the documented file, and the documented consumer didn't recognize it. The earliest signal that would have caught this was grepping `genai_bundle.mjs` for `LITERTLM` **before** running the conversion. Two seconds of work that would have saved the Mac-trip.

Operationally: when a vendor's docs say "we publish artifacts but no recipe," that's a hard stop, not a "we'll figure it out." Trust the silence.

## What ships instead

The fine-tune runs in the browser via wllama (`Maelstrome/lora-wave-session-r32` GGUF Q4_K_M split shards, served as `/gguf/*` from the local-hf mirror). See [`docs/wllama.md`](../wllama.md). Production runtime in [`client/lib/gemma/local-runtime.ts`](../../client/lib/gemma/local-runtime.ts) was not switched to MediaPipe — the test page at [`/models/mediapipe-finetune-test`](../../client/app/models/mediapipe-finetune-test/) is parked, not load-bearing. If `@mediapipe/tasks-genai` ever registers a `LITERTLM` matcher (or `litert-torch` ever grows a `--web-task` flag), the page will be ready and we'll just need to flip a URL.

## File references

- Conversion procedure (with archival caveat): [`mediapipe-mac-conversion.md`](../mediapipe-mac-conversion.md)
- Browser test page (parked, scaffolding intact): [`client/app/models/mediapipe-finetune-test/`](../../client/app/models/mediapipe-finetune-test/)
- Sibling pivots: [`mlc-finetune.md`](./mlc-finetune.md), [`onnx-finetune.md`](./onnx-finetune.md)
- The HF bundle (for anyone repeating this dead-end): `Maelstrome/lora-wave-session-r32` under `mediapipe/`
- The currently-shipping browser runtime: [`docs/wllama.md`](../wllama.md)
- Issue tracking this with reproduction: [Wave#8](https://github.com/emilyLi2020/Wave/issues/8)
- Google staff statement: [HF litert-community/TranslateGemma-4B-IT discussion #1](https://huggingface.co/litert-community/TranslateGemma-4B-IT/discussions/1)
- Canonical upstream issue: [google-ai-edge/LiteRT-LM#2150](https://github.com/google-ai-edge/LiteRT-LM/issues/2150)
