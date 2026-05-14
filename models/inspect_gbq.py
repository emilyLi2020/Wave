"""Diff GatherBlockQuantized layouts between two ONNX files.

Walks every GBQ node in each model and dumps:
  - node attributes (block_size, bits, gather_axis, quantize_axis, etc.)
  - initializer dtypes + shapes for data, scales, zero_points
  - first few packed bytes of each initializer (so we can visually compare nibble order)

Usage:
  python inspect_gbq.py <ours.onnx> <upstream.onnx>
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
import onnx
from onnx import TensorProto, numpy_helper


DTYPE_NAME = {
    TensorProto.FLOAT: "float32",
    TensorProto.FLOAT16: "float16",
    TensorProto.UINT8: "uint8",
    TensorProto.INT8: "int8",
    TensorProto.UINT16: "uint16",
    TensorProto.INT16: "int16",
    TensorProto.UINT32: "uint32",
    TensorProto.INT32: "int32",
    TensorProto.BFLOAT16: "bfloat16",
}


def fmt_dtype(dt: int) -> str:
    return DTYPE_NAME.get(dt, f"dtype#{dt}")


def attr_value(attr) -> object:
    if attr.type == onnx.AttributeProto.INT:
        return attr.i
    if attr.type == onnx.AttributeProto.FLOAT:
        return attr.f
    if attr.type == onnx.AttributeProto.STRING:
        return attr.s.decode("utf-8")
    if attr.type == onnx.AttributeProto.INTS:
        return list(attr.ints)
    if attr.type == onnx.AttributeProto.FLOATS:
        return list(attr.floats)
    return f"<type={attr.type}>"


def initializer_summary(init, max_bytes: int = 16):
    arr = numpy_helper.to_array(init)
    raw = arr.tobytes()[:max_bytes]
    return {
        "name": init.name,
        "dtype": fmt_dtype(init.data_type),
        "shape": list(arr.shape),
        "nbytes": arr.nbytes,
        "first_bytes_hex": raw.hex(),
        "first_values": arr.flatten()[:8].tolist(),
    }


def dump_model(path: Path) -> dict:
    print(f"\n=== {path} ===", flush=True)
    model = onnx.load(str(path), load_external_data=True)
    inits = {i.name: i for i in model.graph.initializer}

    out = {"path": str(path), "nodes": []}
    for node in model.graph.node:
        if node.op_type != "GatherBlockQuantized":
            continue
        n = {
            "name": node.name,
            "domain": node.domain,
            "op_type": node.op_type,
            "inputs": list(node.input),
            "outputs": list(node.output),
            "attrs": {a.name: attr_value(a) for a in node.attribute},
            "initializers": {},
        }
        # Per ORT contrib op spec: inputs are (data, indices, scales, zero_points?)
        labels = ["data", "indices", "scales", "zero_points"]
        for label, name in zip(labels, node.input):
            if name in inits:
                n["initializers"][label] = initializer_summary(inits[name])
        out["nodes"].append(n)

    print(f"Found {len(out['nodes'])} GatherBlockQuantized node(s).", flush=True)
    for n in out["nodes"]:
        print(f"\n  node: {n['name']!r}  domain={n['domain']!r}", flush=True)
        print(f"    attrs: {n['attrs']}", flush=True)
        for label, info in n["initializers"].items():
            print(
                f"    {label}: dtype={info['dtype']} shape={info['shape']} "
                f"bytes={info['nbytes']:,}",
                flush=True,
            )
            print(
                f"      first 16 bytes (hex): {info['first_bytes_hex']}",
                flush=True,
            )
            print(
                f"      first 8 values: {info['first_values']}",
                flush=True,
            )

    # Also dump opset imports and the model's domain version
    print("  opset_import:", flush=True)
    for op in model.opset_import:
        print(f"    domain={op.domain!r} version={op.version}", flush=True)

    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("ours", type=Path)
    parser.add_argument("upstream", type=Path)
    args = parser.parse_args()

    if not args.ours.exists():
        sys.exit(f"missing: {args.ours}")
    if not args.upstream.exists():
        sys.exit(f"missing: {args.upstream}")

    ours = dump_model(args.ours)
    upstream = dump_model(args.upstream)

    print("\n=== DIFF SUMMARY ===", flush=True)
    print(f"  ours:     {len(ours['nodes'])} GBQ node(s)", flush=True)
    print(f"  upstream: {len(upstream['nodes'])} GBQ node(s)", flush=True)

    # Compare first node in each (the per-layer embed table is typically biggest;
    # if both have multiple, we'll line them up by output count).
    pairs: list[tuple[dict, dict]] = []
    for a, b in zip(ours["nodes"], upstream["nodes"]):
        pairs.append((a, b))
    if not pairs:
        print("  no common GBQ nodes to compare", flush=True)
        return

    for i, (a, b) in enumerate(pairs):
        print(f"\n  --- node {i}: ours {a['name']!r} vs upstream {b['name']!r} ---", flush=True)
        # Attributes
        for key in sorted(set(a["attrs"]) | set(b["attrs"])):
            av = a["attrs"].get(key, "<missing>")
            bv = b["attrs"].get(key, "<missing>")
            mark = " " if av == bv else "*"
            print(f"    {mark} attr[{key}]: ours={av!r}  upstream={bv!r}", flush=True)
        # Inputs labels
        for label in ("data", "indices", "scales", "zero_points"):
            ai = a["initializers"].get(label)
            bi = b["initializers"].get(label)
            if ai is None and bi is None:
                continue
            print(f"    label={label}:", flush=True)
            if ai is None:
                print(f"      ours: <missing>", flush=True)
            else:
                print(f"      ours: dtype={ai['dtype']} shape={ai['shape']} hex0={ai['first_bytes_hex']}", flush=True)
            if bi is None:
                print(f"      upstream: <missing>", flush=True)
            else:
                print(f"      upstream: dtype={bi['dtype']} shape={bi['shape']} hex0={bi['first_bytes_hex']}", flush=True)


if __name__ == "__main__":
    main()
