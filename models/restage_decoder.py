"""Take the fused decoder (gpt2 mode) and stage it into onnx-export-v4-fused/
with transformers.js-compatible external data filename (.onnx_data, not .onnx.data).
"""
from __future__ import annotations

from pathlib import Path

import onnx

REPO = Path(__file__).resolve().parents[1]
SRC = REPO / "models" / "runs" / "onnx-fuse-trials" / "decoder_fused_gpt2_h8_d1536.onnx"
DST_DIR = REPO / "models" / "runs" / "onnx-export-v4-fused" / "onnx"
DST_ONNX = DST_DIR / "decoder_model_merged_q4f16.onnx"
DST_DATA_LOCATION = "decoder_model_merged_q4f16.onnx_data"

DST_DIR.mkdir(parents=True, exist_ok=True)

# Remove any prior stage so we don't end up with stale data
for p in (DST_ONNX, DST_DIR / DST_DATA_LOCATION):
    if p.exists():
        p.unlink()

print(f"Loading fused model with external data from {SRC}...", flush=True)
model = onnx.load(str(SRC), load_external_data=True)

print(f"Saving to {DST_ONNX} (external data: {DST_DATA_LOCATION})...", flush=True)
onnx.save_model(
    model,
    str(DST_ONNX),
    save_as_external_data=True,
    all_tensors_to_one_file=True,
    location=DST_DATA_LOCATION,
    size_threshold=1024,
)
print("Done.", flush=True)

# Verify file presence
graph_size = DST_ONNX.stat().st_size
data_size = (DST_DIR / DST_DATA_LOCATION).stat().st_size
print(f"  graph: {graph_size / 1024 / 1024:.1f} MB")
print(f"  external data: {data_size / 1024 / 1024 / 1024:.2f} GB")
