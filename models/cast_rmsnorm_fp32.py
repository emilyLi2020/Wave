"""For RMSNorm chains we couldn't fold into SimplifiedLayerNormalization,
insert Cast(fp16->fp32) before the variance computation and Cast(fp32->fp16)
after Pow. This puts `mean(x²)` accumulation in fp32 internally — same effect
as SimplifiedLayerNormalization's stash_type=1.

The unmatched chains are V-projection norms (no learned weight), per
docs/onnx-webgpu-divergence.md. Their normalized last-dim varies per layer
(256 vs 512 head_dim) so a single ones-weight tensor can't replace all of
them. Casting around the variance avoids needing to know the shape.

Pattern to find (per remaining chain):
  x_fp16 → Mul(x, x) → ReduceMean → Add(_, eps_fp16) → Pow(_, -0.5_fp16) → ...

Rewrite to:
  x_fp16 → Cast(fp32) ─┐
                       Mul → ReduceMean → Add(_, eps_fp32) → Pow(_, -0.5_fp32) → Cast(fp16) → ...

Inputs to the original Mul(x,x) are replaced by the fp32 cast output; new
fp32 constants for eps and exponent are emitted. The existing downstream
Mul(x, rsqrt_fp16) continues to consume fp16.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper


def cast_chains(model) -> tuple[object, int]:
    inits = {i.name: i for i in model.graph.initializer}
    producers = {o: n for n in model.graph.node for o in n.output}

    # Pass 1: collect chain descriptors using the unmodified graph.
    chains: list[dict] = []
    for pow_node in list(model.graph.node):
        if pow_node.op_type != "Pow":
            continue
        if len(pow_node.input) < 2:
            continue
        exp_init = inits.get(pow_node.input[1])
        if exp_init is None:
            continue
        exp_arr = numpy_helper.to_array(exp_init)
        if exp_arr.size != 1 or float(exp_arr.flatten()[0]) != -0.5:
            continue

        add_node = producers.get(pow_node.input[0])
        if not add_node or add_node.op_type != "Add":
            continue
        eps_inp = None
        mean_inp = None
        for inp in add_node.input:
            if inp in inits:
                eps_inp = inp
            else:
                mean_inp = inp
        if eps_inp is None or mean_inp is None:
            continue

        rm_node = producers.get(mean_inp)
        if not rm_node or rm_node.op_type != "ReduceMean":
            continue

        sq_node = producers.get(rm_node.input[0])
        if not sq_node or sq_node.op_type != "Mul" or len(sq_node.input) != 2:
            continue
        if sq_node.input[0] != sq_node.input[1]:
            continue

        chains.append(
            {
                "pow_node": pow_node,
                "add_node": add_node,
                "sq_node": sq_node,
                "x_name": sq_node.input[0],
                "eps_inp": eps_inp,
            }
        )

    # Pass 2: mutate. Generate fresh names per chain, insert Casts, swap inputs.
    new_inits: list = []
    new_cast_nodes: list = []
    for idx, c in enumerate(chains):
        prefix = (c["pow_node"].name or f"chain_{idx}") + "_fp32_"
        x_fp32 = prefix + "x_fp32"
        eps_fp32_name = prefix + "eps_fp32"
        exp_fp32_name = prefix + "exp_fp32"

        eps_arr = numpy_helper.to_array(inits[c["eps_inp"]])
        eps_fp32 = np.asarray(eps_arr, dtype=np.float32)
        new_inits.append(numpy_helper.from_array(eps_fp32, name=eps_fp32_name))
        new_inits.append(
            numpy_helper.from_array(
                np.asarray(-0.5, dtype=np.float32), name=exp_fp32_name
            )
        )

        # Cast x -> fp32
        new_cast_nodes.append(
            helper.make_node(
                "Cast",
                inputs=[c["x_name"]],
                outputs=[x_fp32],
                name=prefix + "to_fp32",
                to=TensorProto.FLOAT,
            )
        )

        # Reroute sq_node to consume fp32 x
        c["sq_node"].input[0] = x_fp32
        c["sq_node"].input[1] = x_fp32

        # Swap eps initializer in add_node
        for i, inp in enumerate(c["add_node"].input):
            if inp == c["eps_inp"]:
                c["add_node"].input[i] = eps_fp32_name

        # Swap exponent constant in pow_node; rename its output; emit new Cast back to fp16
        c["pow_node"].input[1] = exp_fp32_name
        orig_pow_out = c["pow_node"].output[0]
        new_pow_out = orig_pow_out + "_fp32_internal"
        c["pow_node"].output[0] = new_pow_out
        new_cast_nodes.append(
            helper.make_node(
                "Cast",
                inputs=[new_pow_out],
                outputs=[orig_pow_out],
                name=prefix + "to_fp16",
                to=TensorProto.FLOAT16,
            )
        )

    # Append new nodes + inits to the graph (ONNX runtime topologically sorts).
    if new_cast_nodes:
        model.graph.node.extend(new_cast_nodes)
    if new_inits:
        model.graph.initializer.extend(new_inits)

    # Update value_info entries for the intermediate tensors that are now
    # fp32 instead of fp16. ONNX runtime checks these against inferred types
    # and errors if they disagree. The affected outputs are:
    #   sq_node.output[0]  (x*x, was fp16)
    #   rm_node.output[0]  (mean, was fp16)
    #   add_node.output[0] (mean+eps, was fp16)
    #   pow_node.output[0] (rsqrt, was fp16; also renamed to "<orig>_fp32_internal")
    affected_tensor_names: set[str] = set()
    for c in chains:
        affected_tensor_names.add(c["sq_node"].output[0])  # x*x
        # ReduceMean output: still has its original name (we didn't rename); look it up
        rm_in = c["add_node"].input[0] if c["add_node"].input[0] not in {c["eps_inp"]} else c["add_node"].input[1]
        affected_tensor_names.add(rm_in)
        affected_tensor_names.add(c["add_node"].output[0])  # mean+eps
        affected_tensor_names.add(c["pow_node"].output[0])  # already renamed

    # Drop matching value_info entries entirely (let runtime re-infer).
    keep_vi = [vi for vi in model.graph.value_info if vi.name not in affected_tensor_names]
    del model.graph.value_info[:]
    model.graph.value_info.extend(keep_vi)

    return model, len(chains)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("src", type=Path)
    ap.add_argument("dst", type=Path)
    args = ap.parse_args()

    if not args.src.exists():
        sys.exit(f"missing: {args.src}")

    print(f"Loading {args.src} (with external data)...", flush=True)
    model = onnx.load(str(args.src), load_external_data=True)

    print("Wrapping remaining RMSNorm variance chains with fp32 Cast pairs...", flush=True)
    model, count = cast_chains(model)
    print(f"  rewrote {count} chains", flush=True)

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
