"""Streaming fp32 -> fp16 ONNX cast that never holds the full graph in memory.

`onnxconverter_common.float16.convert_float_to_float16` requires `onnx.load(...,
load_external_data=True)` which inlines every initializer into the protobuf.
On a 17 GB Gemma 4 decoder export, that drives peak RAM past 30 GB and OOM-kills
the process even after freeing PyTorch.

This script processes the graph in-place on the small model proto (no external
data loaded), and copies/converts the actual tensor bytes one initializer at a
time into a new external-data file. Peak RAM is bounded by the size of the
largest single initializer (a few hundred MB), not the whole model.

Usage:
  uv run --project models python models/cast_fp16_streaming.py \\
    --src models/runs/onnx-export-v2/onnx/decoder_model_merged.onnx \\
    --dst models/runs/onnx-export-v2/onnx/decoder_model_merged_fp16.onnx
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
import onnx
from onnx import TensorProto, numpy_helper


FP32 = TensorProto.FLOAT
FP16 = TensorProto.FLOAT16

# Clip values to fp16 representable range. onnxconverter_common defaults to ±1e4
# (conservative for intermediate matmul overflow), but that's too aggressive for
# attention masks that use large negative constants (-1e9, -3.4e38) to suppress
# positions before softmax. Clipping those to -1e4 leaks ~e^-1e4 ≈ 0 still, but
# any rounding-up to -inf via Cast attributes can be lossy. Use fp16 max finite
# (~65504) to preserve magnitudes while still avoiding overflow.
FP16_MIN_POSITIVE = 1e-7
FP16_MAX_FINITE = 65504.0


def _clip_for_fp16(arr: np.ndarray) -> np.ndarray:
    """Clip fp32 values into a range that survives fp16 cast without saturation."""
    arr = np.where(
        (arr > 0) & (arr < FP16_MIN_POSITIVE), FP16_MIN_POSITIVE, arr
    )
    arr = np.where(
        (arr < 0) & (arr > -FP16_MIN_POSITIVE), -FP16_MIN_POSITIVE, arr
    )
    arr = np.where(arr > FP16_MAX_FINITE, FP16_MAX_FINITE, arr)
    arr = np.where(arr < -FP16_MAX_FINITE, -FP16_MAX_FINITE, arr)
    return arr


def _fp16_external_name(dst: Path) -> str:
    return dst.stem + ".onnx_data"


def _load_tensor_arr(tensor, base_dir: Path) -> np.ndarray:
    """Read a tensor's underlying values whether they are inline or external."""
    return numpy_helper.to_array(tensor, base_dir=str(base_dir))


def _set_external(tensor, location: str, offset: int, length: int) -> None:
    tensor.ClearField("raw_data")
    tensor.ClearField("float_data")
    tensor.ClearField("double_data")
    tensor.ClearField("int32_data")
    tensor.ClearField("int64_data")
    tensor.ClearField("uint64_data")
    tensor.data_location = TensorProto.EXTERNAL
    del tensor.external_data[:]
    for key, value in (
        ("location", location),
        ("offset", str(offset)),
        ("length", str(length)),
    ):
        entry = tensor.external_data.add()
        entry.key = key
        entry.value = value


def _convert_initializers(
    initializers, ext_path: Path, ext_name: str, base_dir: Path
) -> int:
    """Stream-convert every FLOAT initializer to FLOAT16, write to a new ext file.

    Returns the number of tensors converted. Non-FLOAT initializers are left untouched
    (but if they were external, they keep referencing the OLD external file — we copy
    those into the new file too, so the new ONNX is self-contained relative to ext_path).
    """
    converted = 0
    offset = 0
    with open(ext_path, "wb") as out_fp:
        for tensor in initializers:
            arr = _load_tensor_arr(tensor, base_dir)
            if tensor.data_type == FP32:
                arr = _clip_for_fp16(arr).astype(np.float16, copy=False)
                tensor.data_type = FP16
                converted += 1
            payload = arr.tobytes()
            out_fp.write(payload)
            _set_external(tensor, ext_name, offset, len(payload))
            offset += len(payload)
            del arr, payload
    return converted


def _convert_value_info(value_info_iter) -> int:
    """Walk graph inputs/outputs/value_info: FLOAT element types -> FLOAT16."""
    n = 0
    for vi in value_info_iter:
        t = vi.type.tensor_type
        if t.elem_type == FP32:
            t.elem_type = FP16
            n += 1
    return n


def _convert_nodes(nodes) -> int:
    """Update tensor-valued attributes inside nodes (Constant ops, Cast 'to' field, etc.)."""
    n = 0
    for node in nodes:
        for attr in node.attribute:
            if attr.type == onnx.AttributeProto.TENSOR:
                if attr.t.data_type == FP32:
                    arr = _clip_for_fp16(numpy_helper.to_array(attr.t)).astype(np.float16, copy=False)
                    new_t = numpy_helper.from_array(arr, name=attr.t.name)
                    attr.t.CopyFrom(new_t)
                    n += 1
            elif attr.type == onnx.AttributeProto.TENSORS:
                for t in attr.tensors:
                    if t.data_type == FP32:
                        arr = _clip_for_fp16(numpy_helper.to_array(t)).astype(np.float16, copy=False)
                        new_t = numpy_helper.from_array(arr, name=t.name)
                        t.CopyFrom(new_t)
                        n += 1
            elif attr.type == onnx.AttributeProto.INT and attr.name == "to":
                if attr.i == FP32:
                    attr.i = FP16
                    n += 1
    return n


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--src", type=Path, required=True,
                        help="Path to the source ONNX model (its sidecar .onnx.data must be next to it)")
    parser.add_argument("--dst", type=Path, required=True,
                        help="Path to write the fp16 ONNX model")
    args = parser.parse_args()

    src: Path = args.src.resolve()
    dst: Path = args.dst.resolve()

    if not src.exists():
        sys.exit(f"source not found: {src}")
    dst.parent.mkdir(parents=True, exist_ok=True)

    ext_name = _fp16_external_name(dst)
    ext_path = dst.parent / ext_name
    if ext_path.exists():
        ext_path.unlink()

    print(f"loading proto (no external data) from {src}...", flush=True)
    model = onnx.load(str(src), load_external_data=False)

    print(f"converting {len(model.graph.initializer)} initializers (streaming)...", flush=True)
    n_init = _convert_initializers(
        model.graph.initializer,
        ext_path=ext_path,
        ext_name=ext_name,
        base_dir=src.parent,
    )
    print(f"  converted {n_init} FLOAT initializers; new external file = {ext_path}", flush=True)

    n_inputs = _convert_value_info(model.graph.input)
    n_outputs = _convert_value_info(model.graph.output)
    n_vi = _convert_value_info(model.graph.value_info)
    print(f"  type updates: inputs={n_inputs} outputs={n_outputs} value_info={n_vi}", flush=True)

    n_nodes = _convert_nodes(model.graph.node)
    print(f"  node attribute updates: {n_nodes}", flush=True)

    print(f"saving fp16 model proto to {dst}...", flush=True)
    onnx.save(model, str(dst), save_as_external_data=False)
    print(f"done. model proto = {dst.stat().st_size / 1e6:.1f} MB, "
          f"external data = {ext_path.stat().st_size / 1e9:.2f} GB", flush=True)


if __name__ == "__main__":
    main()
