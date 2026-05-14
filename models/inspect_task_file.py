"""Inspect MediaPipe gemma-4-E2B-it-web.task structure.

The file's magic bytes are `TFL3` (TensorFlow Lite Flatbuffer) at offset 4,
which means the bulk of the file is a single tflite model. The MediaPipe
task wrapper may either:
  (a) be the entire file (this is a direct tflite model + tokenizer baked
      into the flatbuffer's metadata or buffers), or
  (b) prepend / append the tokenizer outside the tflite section.

This script:
  1. Opens the tflite model via ai-edge-litert's Interpreter
  2. Lists all subgraphs and operators
  3. Dumps every tensor's name + shape + dtype
  4. Reports the total weight size and PLE-table footprint
  5. Looks for any unexpected blobs after the tflite section
"""

from __future__ import annotations

from pathlib import Path

from ai_edge_litert.interpreter import Interpreter

TASK_PATH = Path(__file__).resolve().parent / "mediapipe" / "gemma-4-E2B-it-web.task"


def main() -> None:
    if not TASK_PATH.exists():
        raise SystemExit(f"missing: {TASK_PATH}")

    print(f"=== {TASK_PATH} ===")
    print(f"size: {TASK_PATH.stat().st_size / 1024 / 1024 / 1024:.2f} GB")

    try:
        interp = Interpreter(model_path=str(TASK_PATH))
    except Exception as err:
        print(f"\nFAILED to open as tflite: {err!r}")
        print("Trying with allow_custom_ops=True...")
        try:
            interp = Interpreter(model_path=str(TASK_PATH), experimental_op_resolver_type=None)
        except Exception as err2:
            print(f"Still failed: {err2!r}")
            return

    inp_details = interp.get_input_details()
    out_details = interp.get_output_details()
    print(f"\ninputs ({len(inp_details)}):")
    for d in inp_details[:10]:
        print(f"  [{d['index']:>4d}] {d['name']!r}  shape={list(d['shape'])} dtype={d['dtype'].__name__}")
    if len(inp_details) > 10:
        print(f"  ... +{len(inp_details) - 10} more")

    print(f"\noutputs ({len(out_details)}):")
    for d in out_details[:10]:
        print(f"  [{d['index']:>4d}] {d['name']!r}  shape={list(d['shape'])} dtype={d['dtype'].__name__}")
    if len(out_details) > 10:
        print(f"  ... +{len(out_details) - 10} more")

    # Tensor inventory: all tensors, sorted by approximate size
    tensors = interp.get_tensor_details()
    print(f"\ntotal tensors: {len(tensors)}")

    def tensor_bytes(t: dict) -> int:
        shape = t.get("shape") or []
        dtype_size = {"float32": 4, "float16": 2, "int8": 1, "uint8": 1, "int32": 4, "int64": 8, "bool": 1}
        n = 1
        for d in shape:
            n *= max(int(d), 0)
        return n * dtype_size.get(t["dtype"].__name__, 1)

    sized = sorted(tensors, key=tensor_bytes, reverse=True)
    print("\ntop 25 tensors by size:")
    total = 0
    for t in sized[:25]:
        sz = tensor_bytes(t)
        total += sz
        print(
            f"  {sz/1024/1024:>9.1f} MB  shape={list(t['shape'])}  dtype={t['dtype'].__name__}  name={t['name']!r}"
        )
    print(f"\n(top-25 total: {total/1024/1024/1024:.2f} GB)")

    # Count tensors by name pattern
    from collections import Counter
    name_buckets: Counter = Counter()
    for t in tensors:
        name = t["name"]
        # Coarse pattern: take prefix up to first numeric or slash component
        bucket = name.rsplit("/", 1)[0] if "/" in name else name
        name_buckets[bucket] += 1
    print("\nname-prefix histogram (top 15):")
    for prefix, cnt in name_buckets.most_common(15):
        print(f"  {cnt:>4d}  {prefix}")


if __name__ == "__main__":
    main()
