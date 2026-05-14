# Postmortems

Long-form technical narratives of failed and successful attempts. Two rules:

1. Be specific. Cite version numbers, error messages, file paths.
2. Capture the *lesson*, not just the timeline.

| File | Topic | Status |
|---|---|---|
| [`onnx-export.md`](./onnx-export.md) | Hand-rolled ONNX export of fine-tuned Gemma 4 E2B via `torch.onnx.export` + `MatMulNBitsQuantizer`. Got to ~7 GB; PLE Gather tables couldn't be 4-bit packed. | Functional, abandoned in favor of MLC |
| [`mlc-build.md`](./mlc-build.md) | Source build of mlc-llm PR #3485 + relax PR #346 against Gemma 4 E2B. Got to 2.5 GB total, q4f16_1, WebGPU-compiled, fine-tune preserved. | Working as of 2026-05-13 |
