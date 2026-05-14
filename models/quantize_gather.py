"""Pack large fp16 Gather initializers to int4 + GatherBlockQuantized op.

This addresses the size gap between our ONNX exports and upstream's
`onnx-community/gemma-4-E2B-it-ONNX`: the upstream uses `com.microsoft.GatherBlockQuantized`
to compress PLE embedding tables to 4-bit; our MatMul-only quantizer leaves them
at fp16, costing ~4.5 GB of unnecessary storage.

This script is a graph rewrite: load → find Gather ops with large fp16 weight
initializers → replace with com.microsoft.GatherBlockQuantized backed by
packed uint8 (2 nibbles per byte) data + per-block fp16 scales → save with
external data.

Usage:
  python quantize_gather.py <input_dir>

Operates on every *.onnx file in <input_dir>, writes to *.onnx.tmp + .onnx_data.tmp,
then atomically swaps. External data sidecars follow the transformers.js
convention (`<basename>.onnx_data`).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Iterable

import numpy as np

# Lazy imports — only when actually needed
def _import_onnx():
    import onnx
    from onnx import TensorProto, helper, numpy_helper

    return onnx, TensorProto, helper, numpy_helper


def pack_uint4_to_uint8(arr: np.ndarray) -> np.ndarray:
    """Pack uint4 values (range [0, 15]) into uint8 bytes, 2 nibbles per byte.

    Low nibble (bits 0..3) = even index, high nibble (bits 4..7) = odd index.
    """
    nibbles = arr.astype(np.uint8).flatten() & 0x0F
    if nibbles.size % 2 != 0:
        nibbles = np.concatenate([nibbles, np.zeros(1, dtype=np.uint8)])
    low = nibbles[0::2]
    high = nibbles[1::2]
    return (low | (high << 4)).astype(np.uint8)


def quantize_2d_to_uint4_blocks(
    weight_fp16: np.ndarray, block_size: int = 32
) -> tuple[np.ndarray, np.ndarray, np.ndarray, int]:
    """Asymmetric per-block uint4 quantization along axis=1.

    Matches the layout `onnx-community/gemma-4-E2B-it-ONNX` uses for its
    `com.microsoft.GatherBlockQuantized` calls: weights and zero-points are
    both uint4 packed into uint8 (low nibble = even index), scales are fp16.

    Dequant formula: x_fp = (q - zp) * scale.

    Returns (packed_data, scales_fp16, packed_zp, padded_cols).
      packed_data:  shape (rows, padded_cols // 2) uint8
      scales_fp16:  shape (rows, num_blocks)       float16
      packed_zp:    shape (rows, num_blocks // 2)  uint8  (uint4 packed)
    """
    if weight_fp16.ndim != 2:
        raise ValueError(f"expected 2D weight, got shape {weight_fp16.shape}")
    rows, cols = weight_fp16.shape
    num_blocks = (cols + block_size - 1) // block_size
    pad_cols = num_blocks * block_size
    if pad_cols > cols:
        weight_fp16 = np.pad(weight_fp16, ((0, 0), (0, pad_cols - cols)))

    blocks = weight_fp16.reshape(rows, num_blocks, block_size).astype(np.float32)
    block_min = blocks.min(axis=-1, keepdims=True)
    block_max = blocks.max(axis=-1, keepdims=True)
    span = np.maximum(block_max - block_min, 1e-10)
    scale = (span / 15.0).astype(np.float32)
    # Asymmetric zero-point in uint4: maps block_min to quant 0.
    zp = np.round(-block_min / scale).clip(0, 15).astype(np.uint8)
    q = np.round(blocks / scale + zp).clip(0, 15).astype(np.uint8)
    q_flat = q.reshape(rows, pad_cols)

    packed_data_flat = pack_uint4_to_uint8(q_flat)
    packed_data = packed_data_flat.reshape(rows, pad_cols // 2)
    scales = scale.squeeze(-1).astype(np.float16)
    zp_per_block = zp.squeeze(-1)  # shape (rows, num_blocks)
    # Pad num_blocks to even for nibble packing
    if num_blocks % 2 != 0:
        zp_per_block = np.concatenate(
            [zp_per_block, np.zeros((rows, 1), dtype=np.uint8)], axis=1
        )
    packed_zp = pack_uint4_to_uint8(zp_per_block).reshape(rows, -1)
    return packed_data, scales, packed_zp, pad_cols


def quantize_gather_ops(
    model,
    min_elements: int = 1_000_000,
    block_size: int = 32,
) -> tuple[object, int, int]:
    """In-place transform: replace large Gathers with GatherBlockQuantized.

    Returns (model, count_quantized, bytes_saved).
    """
    onnx, TensorProto, helper, numpy_helper = _import_onnx()

    initializer_by_name = {init.name: init for init in model.graph.initializer}
    nodes_to_replace: list[tuple[object, object]] = []
    new_initializers: list[object] = []
    initializers_to_remove: set[str] = set()
    bytes_saved = 0
    count_quantized = 0

    # Count how many non-Gather consumers each initializer has. We can only
    # quantize a Gather weight when the same initializer isn't also being
    # consumed by other op types (Transpose / MatMul / etc.) — common for
    # `tie_word_embeddings=True` setups where embed and lm_head share weights.
    non_gather_consumers: dict[str, int] = {}
    for node in model.graph.node:
        if node.op_type == "Gather":
            continue
        for inp in node.input:
            non_gather_consumers[inp] = non_gather_consumers.get(inp, 0) + 1

    for node in list(model.graph.node):
        if node.op_type != "Gather":
            continue
        data_input = node.input[0]
        if data_input not in initializer_by_name:
            continue
        init = initializer_by_name[data_input]
        if init.data_type not in (TensorProto.FLOAT16, TensorProto.FLOAT):
            continue
        if len(init.dims) != 2:
            continue
        rows, cols = int(init.dims[0]), int(init.dims[1])
        n_elements = rows * cols
        if n_elements < min_elements:
            continue
        if cols % block_size != 0:
            print(
                f"  skip {node.name}: cols={cols} not divisible by block_size={block_size}",
                flush=True,
            )
            continue
        if non_gather_consumers.get(data_input, 0) > 0:
            print(
                f"  skip {node.name}: weight {data_input} is also consumed by "
                f"{non_gather_consumers[data_input]} non-Gather node(s) "
                "(tied weight); quantizing would break those consumers.",
                flush=True,
            )
            continue

        arr = numpy_helper.to_array(init).astype(np.float16)
        packed, scales, packed_zp, _pad_cols = quantize_2d_to_uint4_blocks(
            arr, block_size
        )

        # Original size (fp16): rows * cols * 2 bytes
        # New size: packed data + scales + packed zero-points
        before = rows * cols * 2
        after = packed.nbytes + scales.nbytes + packed_zp.nbytes
        bytes_saved += before - after

        packed_init = numpy_helper.from_array(packed, name=data_input + "_quant")
        scales_init = numpy_helper.from_array(scales, name=data_input + "_scales")
        zp_init = numpy_helper.from_array(packed_zp, name=data_input + "_zp")
        new_initializers.append(packed_init)
        new_initializers.append(scales_init)
        new_initializers.append(zp_init)

        gather_axis = 0
        for attr in node.attribute:
            if attr.name == "axis":
                gather_axis = int(attr.i)

        new_node = helper.make_node(
            "GatherBlockQuantized",
            inputs=[packed_init.name, node.input[1], scales_init.name, zp_init.name],
            outputs=list(node.output),
            domain="com.microsoft",
            name=(node.name or f"GatherBlockQuantized_{count_quantized}") + "_quant",
            block_size=block_size,
            bits=4,
            gather_axis=gather_axis,
            quantize_axis=1,
        )
        nodes_to_replace.append((node, new_node))
        initializers_to_remove.add(data_input)
        count_quantized += 1
        print(
            f"  quantized {node.name}: shape=({rows},{cols}) fp16 "
            f"-> int4 packed; saved {(before - after) / 1024 / 1024:.1f} MB",
            flush=True,
        )

    # Apply replacements
    for old_node, new_node in nodes_to_replace:
        model.graph.node.remove(old_node)
        model.graph.node.append(new_node)

    keep_initializers = [
        init for init in model.graph.initializer if init.name not in initializers_to_remove
    ]
    del model.graph.initializer[:]
    model.graph.initializer.extend(keep_initializers)
    model.graph.initializer.extend(new_initializers)

    # Ensure com.microsoft opset import exists
    has_ms = any(op.domain == "com.microsoft" for op in model.opset_import)
    if not has_ms:
        ms = model.opset_import.add()
        ms.domain = "com.microsoft"
        ms.version = 1

    return model, count_quantized, bytes_saved


def process_file(src: Path, *, dry_run: bool = False) -> None:
    onnx, _, _, _ = _import_onnx()
    print(f"\n=== {src.name} ===", flush=True)
    print("loading (with external data) ...", flush=True)
    model = onnx.load(str(src), load_external_data=True)

    model, count, saved = quantize_gather_ops(model)
    if count == 0:
        print("no eligible Gather ops; skipping write.", flush=True)
        return
    print(
        f"quantized {count} Gather op(s), saved {saved / 1024 / 1024 / 1024:.2f} GB",
        flush=True,
    )

    if dry_run:
        return

    tmp_path = src.with_suffix(".onnx.tmp")
    location = src.stem + ".onnx_data"
    tmp_data = src.parent / (location + ".tmp")
    tmp_data.unlink(missing_ok=True)
    print(f"saving to {tmp_path} (external data: {location}.tmp) ...", flush=True)
    onnx.save(
        model,
        str(tmp_path),
        save_as_external_data=True,
        all_tensors_to_one_file=True,
        location=location + ".tmp",
        size_threshold=1024,
    )

    # Atomic swap
    final_data = src.parent / location
    final_data.unlink(missing_ok=True)
    tmp_data.rename(final_data)
    src.unlink()
    tmp_path.rename(src)

    # The proto we just saved still references `<location>.tmp` in every
    # external_data entry. Rewrite those to the final `<location>` so the
    # ONNX is self-consistent after the rename.
    fix_model = onnx.load(str(src), load_external_data=False)
    fixed = 0
    for init in fix_model.graph.initializer:
        for entry in init.external_data:
            if entry.key == "location" and entry.value.endswith(".tmp"):
                entry.value = entry.value[:-4]
                fixed += 1
    if fixed:
        onnx.save(fix_model, str(src), save_as_external_data=False)
    print(f"swapped: {src} + {final_data} (fixed {fixed} .tmp refs)", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "input_dir",
        type=Path,
        help="Directory containing *.onnx files (e.g. models/runs/onnx-export/onnx)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would happen without writing files",
    )
    args = parser.parse_args()

    if not args.input_dir.is_dir():
        sys.exit(f"not a directory: {args.input_dir}")

    onnx_files: list[Path] = sorted(args.input_dir.glob("*.onnx"))
    if not onnx_files:
        sys.exit(f"no *.onnx files in {args.input_dir}")

    print(f"Found {len(onnx_files)} ONNX file(s):", flush=True)
    for p in onnx_files:
        print(f"  {p.name}", flush=True)

    for p in onnx_files:
        try:
            process_file(p, dry_run=args.dry_run)
        except Exception as err:
            print(f"!! {p.name} failed: {err!r}", flush=True)
            raise


if __name__ == "__main__":
    main()
