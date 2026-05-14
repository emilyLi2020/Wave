"""Fuse our decomposed RMSNorm 6-tuple into a single SimplifiedLayerNormalization
op. This is the structural fix for the onnxruntime-web WebGPU fp16 overflow:
the standard `SimplifiedLayerNormalization` op uses `stash_type=1` (fp32) for
internal variance accumulation, sidestepping the fp16 saturation that breaks
our decomposed `Mul(x,x) + ReduceMean` path on long-context prompts.

Pattern to match (per RMSNorm instance):
  view → Mul(view, view)           [x*x — was Pow(x,2) before rewrite_pow_to_mul]
       → ReduceMean(axes=[-1], keepdims=1)
       → Add(_, eps_const)
       → Pow(_, -0.5)
       → Mul(view, _)              [x * rsqrt]
       → Mul(_, weight_init)

Replacement:
  view → SimplifiedLayerNormalization(view, weight, axis=-1, epsilon=eps, stash_type=1)

Usage:
  python fuse_rmsnorm.py <input.onnx> <output.onnx>
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import onnx
from onnx import helper, numpy_helper


def collect_producers(model) -> dict:
    return {out: n for n in model.graph.node for out in n.output}


def collect_consumers(model) -> dict:
    cons: dict[str, list] = {}
    for n in model.graph.node:
        for inp in n.input:
            cons.setdefault(inp, []).append(n)
    return cons


def get_init_value(inits: dict, name: str):
    if name not in inits:
        return None
    return numpy_helper.to_array(inits[name])


def fuse(model) -> tuple[object, int]:
    inits = {i.name: i for i in model.graph.initializer}
    producers = collect_producers(model)
    consumers = collect_consumers(model)

    fused = 0
    drop_nodes: set[int] = set()  # by id()
    new_nodes: list = []

    # Pre-pass: find every Pow node whose exponent is -0.5 (the rsqrt step).
    for pow_node in list(model.graph.node):
        if pow_node.op_type != "Pow":
            continue
        if id(pow_node) in drop_nodes:
            continue
        if len(pow_node.input) < 2:
            continue
        exp_arr = get_init_value(inits, pow_node.input[1])
        if exp_arr is None:
            continue
        exp_set = set(float(v) for v in exp_arr.flatten().tolist())
        if exp_set != {-0.5}:
            continue

        # Backward: Pow.input[0] should be Add(mean, eps)
        add_node = producers.get(pow_node.input[0])
        if add_node is None or add_node.op_type != "Add":
            continue
        # One Add input is the ReduceMean output, the other is the eps initializer
        eps_value = None
        mean_output = None
        for inp in add_node.input:
            if inp in inits:
                arr = get_init_value(inits, inp)
                if arr is not None and arr.size == 1:
                    eps_value = float(arr.flatten()[0])
                    continue
            mean_output = inp
        if eps_value is None or mean_output is None:
            continue

        # mean_output should be produced by ReduceMean
        rm_node = producers.get(mean_output)
        if rm_node is None or rm_node.op_type != "ReduceMean":
            continue

        # ReduceMean's input should be produced by Mul(x, x)
        sq_node = producers.get(rm_node.input[0])
        if sq_node is None or sq_node.op_type != "Mul":
            continue
        if len(sq_node.input) != 2 or sq_node.input[0] != sq_node.input[1]:
            continue
        x_name = sq_node.input[0]

        # Forward: Pow output -> Mul(view, _) where one input is x_name
        pow_out = pow_node.output[0]
        mul_xrsqrt_candidates = consumers.get(pow_out, [])
        if len(mul_xrsqrt_candidates) != 1:
            continue
        mul_xrsqrt = mul_xrsqrt_candidates[0]
        if mul_xrsqrt.op_type != "Mul" or len(mul_xrsqrt.input) != 2:
            continue
        if x_name not in mul_xrsqrt.input:
            continue

        # Forward: Mul(x, rsqrt) -> Mul(_, weight)
        mul_weight_candidates = consumers.get(mul_xrsqrt.output[0], [])
        if len(mul_weight_candidates) != 1:
            continue
        mul_weight = mul_weight_candidates[0]
        if mul_weight.op_type != "Mul" or len(mul_weight.input) != 2:
            continue
        weight_name = None
        for inp in mul_weight.input:
            if inp in inits:
                weight_name = inp
                break
        if weight_name is None:
            continue

        # All 6 nodes matched. Build the replacement.
        final_output = mul_weight.output[0]
        node_name = (pow_node.name or f"rmsnorm_{fused}") + "_fused"
        sln = helper.make_node(
            "SimplifiedLayerNormalization",
            inputs=[x_name, weight_name],
            outputs=[final_output],
            name=node_name,
            domain="",
            axis=-1,
            epsilon=eps_value,
            stash_type=1,  # fp32 internal accumulation — avoids fp16 overflow on WebGPU
        )

        drop_nodes.update(
            id(n) for n in (sq_node, rm_node, add_node, pow_node, mul_xrsqrt, mul_weight)
        )
        new_nodes.append(sln)
        fused += 1

    # Apply: replace dropped nodes with the new SimplifiedLayerNormalization nodes,
    # preserving the rest in order.
    rebuilt: list = []
    inserted_sln = False
    for n in list(model.graph.node):
        if id(n) in drop_nodes:
            # Insert all new nodes once at the first dropped position
            if not inserted_sln:
                rebuilt.extend(new_nodes)
                inserted_sln = True
            continue
        rebuilt.append(n)
    if not inserted_sln:
        rebuilt.extend(new_nodes)

    del model.graph.node[:]
    model.graph.node.extend(rebuilt)
    return model, fused


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("src", type=Path)
    ap.add_argument("dst", type=Path)
    args = ap.parse_args()

    if not args.src.exists():
        sys.exit(f"missing: {args.src}")

    print(f"Loading {args.src} (with external data)...", flush=True)
    model = onnx.load(str(args.src), load_external_data=True)

    print("Fusing RMSNorm decompositions -> SimplifiedLayerNormalization ...", flush=True)
    model, count = fuse(model)
    print(f"  fused {count} RMSNorm chains", flush=True)

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
