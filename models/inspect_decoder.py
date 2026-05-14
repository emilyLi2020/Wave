"""High-level diff of decoder ONNX graphs: I/O signature, node counts, opset.

Usage:
  python inspect_decoder.py <ours.onnx> <upstream.onnx>
"""
from __future__ import annotations

import argparse
import sys
from collections import Counter
from pathlib import Path

import onnx

ELEM_DTYPE = {
    onnx.TensorProto.FLOAT: "float32",
    onnx.TensorProto.FLOAT16: "float16",
    onnx.TensorProto.UINT8: "uint8",
    onnx.TensorProto.INT8: "int8",
    onnx.TensorProto.UINT16: "uint16",
    onnx.TensorProto.INT16: "int16",
    onnx.TensorProto.UINT32: "uint32",
    onnx.TensorProto.INT32: "int32",
    onnx.TensorProto.UINT64: "uint64",
    onnx.TensorProto.INT64: "int64",
    onnx.TensorProto.BOOL: "bool",
    onnx.TensorProto.BFLOAT16: "bfloat16",
}


def fmt_tensor_type(t) -> str:
    if t.type.tensor_type.elem_type:
        dtype = ELEM_DTYPE.get(
            t.type.tensor_type.elem_type, f"dt#{t.type.tensor_type.elem_type}"
        )
        shape = []
        for d in t.type.tensor_type.shape.dim:
            if d.HasField("dim_value"):
                shape.append(str(d.dim_value))
            elif d.HasField("dim_param"):
                shape.append(d.dim_param)
            else:
                shape.append("?")
        return f"{dtype}[{','.join(shape)}]"
    return "<non-tensor>"


def summarize(path: Path) -> None:
    print(f"\n=== {path} ===", flush=True)
    model = onnx.load(str(path), load_external_data=False)
    print(f"  opset imports:", flush=True)
    for op in model.opset_import:
        print(f"    domain={op.domain!r} version={op.version}", flush=True)
    print(f"  inputs ({len(model.graph.input)}):", flush=True)
    for inp in model.graph.input[:5]:
        print(f"    {inp.name}: {fmt_tensor_type(inp)}", flush=True)
    if len(model.graph.input) > 5:
        print(f"    ... +{len(model.graph.input) - 5} more", flush=True)
    print(f"  outputs ({len(model.graph.output)}):", flush=True)
    for out in model.graph.output[:5]:
        print(f"    {out.name}: {fmt_tensor_type(out)}", flush=True)
    if len(model.graph.output) > 5:
        print(f"    ... +{len(model.graph.output) - 5} more", flush=True)
    op_counts = Counter(n.op_type for n in model.graph.node)
    print(f"  nodes (total {sum(op_counts.values())}):", flush=True)
    for op, n in sorted(op_counts.items(), key=lambda x: -x[1])[:20]:
        print(f"    {n:>6d}  {op}", flush=True)


def diff_io(a_path: Path, b_path: Path) -> None:
    a = onnx.load(str(a_path), load_external_data=False)
    b = onnx.load(str(b_path), load_external_data=False)
    print("\n=== I/O SIGNATURE DIFF ===", flush=True)

    a_inputs = {i.name: fmt_tensor_type(i) for i in a.graph.input}
    b_inputs = {i.name: fmt_tensor_type(i) for i in b.graph.input}
    only_a = set(a_inputs) - set(b_inputs)
    only_b = set(b_inputs) - set(a_inputs)
    both = set(a_inputs) & set(b_inputs)
    print(f"  inputs: ours={len(a_inputs)} upstream={len(b_inputs)}", flush=True)
    if only_a:
        print(f"    only in ours: {sorted(only_a)[:10]}{'...' if len(only_a) > 10 else ''}", flush=True)
    if only_b:
        print(f"    only in upstream: {sorted(only_b)[:10]}{'...' if len(only_b) > 10 else ''}", flush=True)
    diff_types = [(n, a_inputs[n], b_inputs[n]) for n in both if a_inputs[n] != b_inputs[n]]
    if diff_types:
        print(f"    same-name, different-type:", flush=True)
        for n, av, bv in diff_types[:10]:
            print(f"      {n}: ours={av}  upstream={bv}", flush=True)

    a_outputs = {o.name: fmt_tensor_type(o) for o in a.graph.output}
    b_outputs = {o.name: fmt_tensor_type(o) for o in b.graph.output}
    only_a = set(a_outputs) - set(b_outputs)
    only_b = set(b_outputs) - set(a_outputs)
    print(f"  outputs: ours={len(a_outputs)} upstream={len(b_outputs)}", flush=True)
    if only_a:
        print(f"    only in ours: {sorted(only_a)[:10]}{'...' if len(only_a) > 10 else ''}", flush=True)
    if only_b:
        print(f"    only in upstream: {sorted(only_b)[:10]}{'...' if len(only_b) > 10 else ''}", flush=True)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("ours", type=Path)
    ap.add_argument("upstream", type=Path)
    args = ap.parse_args()
    if not args.ours.exists() or not args.upstream.exists():
        sys.exit("missing input file")
    summarize(args.ours)
    summarize(args.upstream)
    diff_io(args.ours, args.upstream)


if __name__ == "__main__":
    main()
