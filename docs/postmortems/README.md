# Postmortems

Long-form technical narratives of failed and successful attempts. Two rules:

1. Be specific. Cite version numbers, error messages, file paths.
2. Capture the *lesson*, not just the timeline.

| File | Topic | Status |
|---|---|---|
| [`onnx-export.md`](./onnx-export.md) | Hand-rolled ONNX export of fine-tuned Gemma 4 E2B via `torch.onnx.export` + `MatMulNBitsQuantizer`. Got to ~7 GB; PLE Gather tables couldn't be 4-bit packed. | Functional, abandoned in favor of MLC |
| [`mlc-build.md`](./mlc-build.md) | Source build of mlc-llm PR #3485 + relax PR #346 against Gemma 4 E2B. Got to 2.5 GB total, q4f16_1, WebGPU-compiled, fine-tune preserved. | Working as of 2026-05-13 |
| [`mlc-finetune.md`](./mlc-finetune.md) | Getting the fine-tune (and base models) actually generating coherent text in-browser via `@mlc-ai/web-llm`. Includes the broken-merge root cause, the phantom scaling fix, and the real Gemma 4 conv_template gap. | All three models work for prompt #1; state leakage between sequential calls is the open blocker for multi-turn shipping. |
| [`mediapipe-finetune.md`](./mediapipe-finetune.md) | Mac-side conversion of the fine-tune via `litert-torch export_hf` produced a 4.7 GB `LITERTLM`-magic bundle. `@mediapipe/tasks-genai` (stable + nightly) only registers a `TFL3` matcher; no browser consumer for `LITERTLM` exists. Google staff confirmed publicly there is no Gemma 4 fine-tune → web-`.task` recipe. | Dead end. Page parked at `/models/mediapipe-finetune-test`; ships via wllama/GGUF instead. |
