"""Rewrite `Pow(x, 2.0)` -> `Mul(x, x)` in an ONNX decoder.

Why: WebGPU's `Pow` kernel implements y^x as `exp(x * ln(y))`, which produces
NaN for any negative base. RMSNorm's variance term `Pow(x, 2)` operates on raw
activations that routinely go negative -> NaN propagates -> first-token logits
collapse -> argmax picks a stop token -> empty output.

`Mul(x, x)` always computes x*x correctly regardless of sign.

We leave `Pow(x, -0.5)` alone: its input is `mean(x²) + eps` which is provably
non-negative, so the exp/ln path is safe for that op.

Usage:
  python rewrite_pow_to_mul.py <input.onnx> <output.onnx>
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import onnx
from onnx import helper, numpy_helper


def rewrite(model) -> tuple[object, int]:
    inits = {i.name: i for i in model.graph.initializer}
    rewritten = 0
    new_nodes = []
    # Track which initializers we can drop (only if no other consumer).
    consumers: dict[str, int] = {}
    for n in model.graph.node:
        for inp in n.input:
            consumers[inp] = consumers.get(inp, 0) + 1
    drop_init_names: set[str] = set()

    for n in model.graph.node:
        if n.op_type != "Pow":
            new_nodes.append(n)
            continue
        if len(n.input) < 2:
            new_nodes.append(n)
            continue
        exp_name = n.input[1]
        if exp_name not in inits:
            new_nodes.append(n)
            continue
        arr = numpy_helper.to_array(inits[exp_name])
        flat = arr.flatten()
        if flat.size == 0:
            new_nodes.append(n)
            continue
        unique = set(float(v) for v in flat.tolist())
        if unique != {2.0}:
            new_nodes.append(n)
            continue

        # Rewrite: Pow(x, 2.0) -> Mul(x, x)
        x = n.input[0]
        mul_node = helper.make_node(
            "Mul",
            inputs=[x, x],
            outputs=list(n.output),
            name=(n.name or f"Pow_rewritten_{rewritten}") + "_mul",
        )
        new_nodes.append(mul_node)
        rewritten += 1
        # Decrement consumer count for the dropped exponent init; mark drop
        # if no other node consumed it.
        consumers[exp_name] -= 1
        if consumers[exp_name] <= 0:
            drop_init_names.add(exp_name)

    # Replace graph nodes
    del model.graph.node[:]
    model.graph.node.extend(new_nodes)

    # Drop now-unused exponent initializers
    if drop_init_names:
        keep = [i for i in model.graph.initializer if i.name not in drop_init_names]
        del model.graph.initializer[:]
        model.graph.initializer.extend(keep)

    return model, rewritten


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("src", type=Path)
    ap.add_argument("dst", type=Path)
    args = ap.parse_args()

    if not args.src.exists():
        sys.exit(f"missing: {args.src}")

    print(f"Loading {args.src} (with external data)...", flush=True)
    model = onnx.load(str(args.src), load_external_data=True)

    print("Rewriting Pow(x, 2.0) -> Mul(x, x) ...", flush=True)
    model, count = rewrite(model)
    print(f"  rewrote {count} Pow node(s)", flush=True)

    args.dst.parent.mkdir(parents=True, exist_ok=True)
    location = args.dst.stem + ".onnx_data"
    sidecar = args.dst.parent / location
    sidecar.unlink(missing_ok=True)

    print(f"Saving to {args.dst} (external data: {location}) ...", flush=True)
    onnx.save(
        model,
        str(args.dst),
        save_as_external_data=True,
        all_tensors_to_one_file=True,
        location=location,
        size_threshold=1024,
    )
    print("Done.", flush=True)


if __name__ == "__main__":
    main()
