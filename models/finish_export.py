"""Finish a partial ONNX export from fp16 intermediates.

Picks up after `cast_fp16_streaming.py` produced
  onnx/decoder_model_merged_fp16.onnx{,_data}
  onnx/embed_tokens_fp16.onnx{,_data}
and drives the rest of the pipeline:
  1. Quantize decoder fp16 -> q4f16 via MatMulNBitsQuantizer
  2. Quantize embed fp16   -> q4f16 same way
  3. Run quantize_gather.py post-pass to int4 the PLE Gather tables
  4. Copy runtime configs (tokenizer, chat template, etc.) from --source-dir
  5. Write export-manifest.json
  6. Validate output

Usage:
  uv run --project models python models/finish_export.py \\
    --source-dir models/runs/merge-peft \\
    --out-dir models/runs/onnx-export-v2
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import shutil
import sys
from pathlib import Path


REQUIRED_OUTPUTS = (
    "onnx/decoder_model_merged_q4f16.onnx",
    "onnx/decoder_model_merged_q4f16.onnx_data",
    "onnx/embed_tokens_q4f16.onnx",
    "onnx/embed_tokens_q4f16.onnx_data",
)
RUNTIME_FILES = (
    "config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "chat_template.jinja",
    "special_tokens_map.json",
    "processor_config.json",
    "generation_config.json",
)


def _delete_onnx_with_sidecars(path: Path) -> None:
    if not path.exists():
        return
    path.unlink(missing_ok=True)
    sidecar1 = path.with_suffix(".onnx_data")
    sidecar2 = path.with_suffix(".onnx.data")
    for s in (sidecar1, sidecar2):
        if s.exists():
            s.unlink()


def _quantize_q4f16(src: Path, dst: Path) -> None:
    """Apply q4 MatMul quantization with fp16 scales."""
    import onnx

    QuantizerCls = None
    for import_path, attr in (
        ("onnxruntime.quantization.matmul_nbits_quantizer", "MatMulNBitsQuantizer"),
        ("onnxruntime.quantization.matmul_4bits_quantizer", "MatMul4BitsQuantizer"),
        ("onnxruntime.quantization", "MatMulNBitsQuantizer"),
        ("onnxruntime.quantization", "MatMul4BitsQuantizer"),
    ):
        try:
            module = __import__(import_path, fromlist=[attr])
            QuantizerCls = getattr(module, attr)
            print(f"  q4f16: using {import_path}.{attr}", flush=True)
            break
        except (ImportError, AttributeError):
            continue

    if QuantizerCls is None:
        sys.exit("Could not locate a 4-bit MatMul quantizer in onnxruntime.")

    print(f"  loading fp16 model {src}...", flush=True)
    model = onnx.load(str(src), load_external_data=True)

    print("  quantizing MatMul -> MatMulNBits (int4 + fp16 scales)...", flush=True)
    quantizer = QuantizerCls(model, block_size=32, is_symmetric=True, accuracy_level=4)
    quantizer.process()

    location = dst.stem + ".onnx_data"
    sidecar = dst.parent / location
    if sidecar.exists():
        sidecar.unlink()
    print(f"  saving quantized model to {dst}...", flush=True)
    onnx.save(
        quantizer.model.model,
        str(dst),
        save_as_external_data=True,
        all_tensors_to_one_file=True,
        location=location,
        size_threshold=1024,
    )
    print(f"  wrote {dst} ({dst.stat().st_size / 1e6:.1f} MB proto, "
          f"{sidecar.stat().st_size / 1e9:.2f} GB sidecar)", flush=True)


def _copy_runtime_configs(source_dir: Path, out_dir: Path) -> list[str]:
    copied = []
    for fname in RUNTIME_FILES:
        src = source_dir / fname
        if not src.exists():
            print(f"  source missing {fname} (skipping)", flush=True)
            continue
        shutil.copy2(src, out_dir / fname)
        copied.append(fname)
        print(f"  copied {fname}", flush=True)
    return copied


def _validate(out_dir: Path) -> None:
    missing = [r for r in REQUIRED_OUTPUTS if not (out_dir / r).exists()]
    if missing:
        sys.exit(f"validation failed: missing files:\n  " + "\n  ".join(missing))
    forbidden = list(out_dir.glob("onnx/vision_encoder*")) + list(out_dir.glob("onnx/audio_encoder*"))
    if forbidden:
        sys.exit(f"validation failed: forbidden files present:\n  " + "\n  ".join(str(f) for f in forbidden))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", required=True, type=Path,
                        help="Local merged-base directory whose runtime configs we copy")
    parser.add_argument("--out-dir", required=True, type=Path,
                        help="Export output directory (must contain onnx/*_fp16.onnx already)")
    parser.add_argument("--skip-gather", action="store_true",
                        help="Skip the quantize_gather.py post-pass (PLE int4 compression)")
    args = parser.parse_args()

    source_dir = args.source_dir.resolve()
    out_dir = args.out_dir.resolve()
    onnx_dir = out_dir / "onnx"

    decoder_fp16 = onnx_dir / "decoder_model_merged_fp16.onnx"
    decoder_q4 = onnx_dir / "decoder_model_merged_q4f16.onnx"
    embed_fp16 = onnx_dir / "embed_tokens_fp16.onnx"
    embed_q4 = onnx_dir / "embed_tokens_q4f16.onnx"

    if not decoder_fp16.exists() or not embed_fp16.exists():
        sys.exit(f"missing fp16 intermediates in {onnx_dir}; run cast_fp16_streaming.py first")

    if decoder_q4.exists():
        print(f"q4f16 decoder already exists at {decoder_q4}, skipping", flush=True)
    else:
        print(f"quantizing decoder fp16 -> q4f16 ({decoder_fp16})...", flush=True)
        _quantize_q4f16(decoder_fp16, decoder_q4)

    if embed_q4.exists():
        print(f"q4f16 embed already exists at {embed_q4}, skipping", flush=True)
    else:
        print(f"quantizing embed_tokens fp16 -> q4f16 ({embed_fp16})...", flush=True)
        _quantize_q4f16(embed_fp16, embed_q4)

    # Clean up fp16 intermediates now that q4f16 versions exist.
    _delete_onnx_with_sidecars(decoder_fp16)
    _delete_onnx_with_sidecars(embed_fp16)

    print("\ncopying runtime configs...", flush=True)
    runtime_copied = _copy_runtime_configs(source_dir, out_dir)

    if not args.skip_gather:
        print("\nrunning quantize_gather.py post-pass (PLE int4 compression)...", flush=True)
        from importlib import import_module
        # quantize_gather.py is a sibling script; run it on the onnx subdir
        import subprocess
        subprocess.run(
            [sys.executable, str(Path(__file__).parent / "quantize_gather.py"), str(onnx_dir)],
            check=True,
        )

    print("\nvalidating output...", flush=True)
    _validate(out_dir)

    manifest_path = out_dir / "export-manifest.json"
    sizes = {}
    for p in onnx_dir.iterdir():
        sizes[p.name] = p.stat().st_size
    manifest = {
        "sourceDir": str(source_dir),
        "outDir": str(out_dir),
        "track": "B-resumed",
        "dtype": "q4f16",
        "gather_quantized": not args.skip_gather,
        "runtime_files_copied": runtime_copied,
        "onnx_files": sizes,
        "timestamp": dt.datetime.now(dt.timezone.utc).isoformat(),
    }
    manifest_path.write_text(json.dumps(manifest, indent=2))
    print(f"\nwrote {manifest_path}", flush=True)
    print(json.dumps(manifest, indent=2), flush=True)
    print("\nfinish_export complete.", flush=True)


if __name__ == "__main__":
    main()
