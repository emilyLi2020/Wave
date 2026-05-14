"""Export a fine-tuned Gemma 4 E2B merged checkpoint to text-only q4f16 ONNX.

Pipeline:
  1. Download merged-16bit safetensors from HF (e.g. Maelstrome/lora-wave-session-r32-merged).
  2. Track A (primary): run transformers.js's scripts/convert.py with task=text-generation-with-past,
     mode=q4f16. The converter loads only Gemma4TextForCausalLM and skips vision/audio.
  3. Track B (fallback): hand-rolled torch.onnx.export against the text submodel, then
     onnxruntime q4f16 quantization. First-pass implementation; may need iteration.
  4. Validate output: must contain decoder + embed_tokens at q4f16; must NOT contain
     vision_encoder_* or audio_encoder_*.
  5. Copy non-ONNX runtime files (configs, tokenizer, chat template).
  6. Write export-manifest.json.
  7. If --push: create HF repo (idempotent) and upload_folder. Requires HF_TOKEN env var.

Usage:
  uv run python export_text_onnx.py \\
    --source-repo Maelstrome/lora-wave-session-r32-merged \\
    --out-dir models/runs/onnx-export \\
    --target-repo Maelstrome/lora-wave-session-r32-onnx \\
    [--push]
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Iterable


TRANSFORMERS_JS_REPO = "https://github.com/huggingface/transformers.js.git"
TRANSFORMERS_JS_PIN = "main"  # pin to a specific commit once we know one works

REQUIRED_OUTPUT_FILES: tuple[str, ...] = (
    "onnx/decoder_model_merged_q4f16.onnx",
    "onnx/decoder_model_merged_q4f16.onnx_data",
    "onnx/embed_tokens_q4f16.onnx",
    "onnx/embed_tokens_q4f16.onnx_data",
)
FORBIDDEN_PREFIXES: tuple[str, ...] = (
    "onnx/vision_encoder",
    "onnx/audio_encoder",
)
RUNTIME_CONFIG_FILES: tuple[str, ...] = (
    "config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "chat_template.jinja",
    "special_tokens_map.json",
    "processor_config.json",
)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-repo", required=True, type=str,
                        help="HF repo id of the merged-16bit checkpoint")
    parser.add_argument("--out-dir", required=True, type=Path,
                        help="Local output directory for the ONNX artifacts")
    parser.add_argument("--target-repo", type=str, default=None,
                        help="HF repo id to upload to when --push is set")
    parser.add_argument("--push", action="store_true",
                        help="Upload the export to --target-repo via HF_TOKEN")
    parser.add_argument("--cache-dir", type=Path, default=None,
                        help="HuggingFace cache dir override for the source snapshot")
    parser.add_argument("--track", choices=["auto", "a", "b"], default="auto",
                        help="Force a specific export track. 'auto' tries A then B.")
    args = parser.parse_args()

    if args.push and not args.target_repo:
        sys.exit("--push requires --target-repo")

    out_dir: Path = args.out_dir.resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "onnx").mkdir(exist_ok=True)

    print(f"source   : {args.source_repo}", flush=True)
    print(f"out      : {out_dir}", flush=True)
    print(f"target   : {args.target_repo or '(local only)'}", flush=True)
    print(f"track    : {args.track}", flush=True)

    source_path = download_source(args.source_repo, args.cache_dir)
    print(f"snapshot : {source_path}", flush=True)

    track_used = run_export(source_path, out_dir, args.track)

    copy_runtime_configs(source_path, out_dir)
    validate_output(out_dir)
    manifest = write_manifest(out_dir, args.source_repo, track_used)
    print(f"wrote    : {out_dir / 'export-manifest.json'}", flush=True)
    print(json.dumps(manifest, indent=2), flush=True)

    if args.push:
        push_to_hub(out_dir, args.target_repo)


def download_source(repo_id: str, cache_dir: Path | None) -> Path:
    local_candidate = Path(repo_id)
    if local_candidate.exists() and local_candidate.is_dir():
        print(f"Using local source directory: {local_candidate}", flush=True)
        return local_candidate.resolve()

    print("Downloading source merged-16bit snapshot...", flush=True)
    from huggingface_hub import snapshot_download

    return Path(snapshot_download(
        repo_id=repo_id,
        cache_dir=str(cache_dir) if cache_dir else None,
        allow_patterns=[
            "*.safetensors",
            "*.json",
            "*.jinja",
            "tokenizer*",
            "special_tokens_map.json",
        ],
    ))


def run_export(source_path: Path, out_dir: Path, track: str) -> str:
    if track in ("auto", "a"):
        try:
            run_track_a(source_path, out_dir)
            return "A"
        except TrackUnavailableError as err:
            if track == "a":
                sys.exit(f"Track A failed: {err}")
            print(f"Track A unavailable ({err}); falling back to Track B.", flush=True)

    run_track_b(source_path, out_dir)
    return "B"


class TrackUnavailableError(RuntimeError):
    """Raised when Track A cannot export this model (architecture unsupported, etc.)."""


def run_track_a(source_path: Path, out_dir: Path) -> None:
    print("Track A: cloning transformers.js converter...", flush=True)
    with tempfile.TemporaryDirectory(prefix="tjs-convert-") as workdir:
        repo_dir = Path(workdir) / "transformers.js"
        subprocess.run(
            ["git", "clone", "--depth", "1", "--branch", TRANSFORMERS_JS_PIN,
             TRANSFORMERS_JS_REPO, str(repo_dir)],
            check=True,
        )

        scripts_dir = repo_dir / "scripts"
        requirements = scripts_dir / "requirements.txt"
        if not (scripts_dir / "convert.py").exists() or not requirements.exists():
            raise TrackUnavailableError(
                "transformers.js convert.py or requirements.txt missing in the cloned repo"
            )

        print("Track A: installing converter requirements (isolated)...", flush=True)
        subprocess.run(
            [sys.executable, "-m", "pip", "install", "--quiet",
             "-r", str(requirements)],
            check=True,
        )

        print("Track A: running scripts/convert.py for text-generation-with-past + q4f16...",
              flush=True)
        result = subprocess.run(
            [sys.executable, str(scripts_dir / "convert.py"),
             "--model_id", str(source_path),
             "--task", "text-generation-with-past",
             "--quantize",
             "--modes", "q4f16",
             "--output_parent_dir", str(out_dir.parent),
             "--output_dir", out_dir.name],
            capture_output=True,
            text=True,
        )

        if result.returncode != 0:
            err = (result.stderr or "") + (result.stdout or "")
            unsupported_hints = (
                "model_type=gemma4",
                "Unsupported architecture",
                "KeyError: 'gemma4'",
                "is not supported",
            )
            if any(hint.lower() in err.lower() for hint in unsupported_hints):
                raise TrackUnavailableError(
                    "transformers.js convert.py does not yet support Gemma 4"
                )
            sys.exit(f"Track A subprocess failed:\n{err}")

        print("Track A: convert.py finished.", flush=True)


def run_track_b(source_path: Path, out_dir: Path) -> None:
    """Hand-rolled torch.onnx.export of the text-only sub-tree.

    First-pass implementation. The KV-cache dynamic axes and prefill/decode
    merged-graph wrapper follow the layout transformers.js expects from
    `onnx-community/gemma-4-E2B-it-ONNX`. Iterate here if export fails on real
    weights — common fixes: opset bump, dtype coercion, KV cache layout tweaks.
    """
    print("Track B: loading text-only sub-model in fp32...", flush=True)
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

    model = AutoModelForCausalLM.from_pretrained(
        str(source_path),
        torch_dtype=torch.float32,
        device_map="cpu",
        attn_implementation="eager",
    )
    model.eval()
    tokenizer = AutoTokenizer.from_pretrained(str(source_path))

    text_model = _extract_text_causal_lm(model)
    text_config = _extract_text_config(model, text_model)

    n_layers = text_config.num_hidden_layers
    n_kv_heads = text_config.num_key_value_heads
    head_dim = getattr(
        text_config,
        "head_dim",
        text_config.hidden_size // text_config.num_attention_heads,
    )

    print(
        f"Track B: text_model={type(text_model).__name__} "
        f"layers={n_layers} kv_heads={n_kv_heads} head_dim={head_dim}",
        flush=True,
    )

    decoder_path = out_dir / "onnx" / "decoder_model_merged.onnx"
    print(f"Track B: torch.onnx.export -> {decoder_path}...", flush=True)

    from transformers.cache_utils import DynamicCache

    class MergedDecoderWrapper(torch.nn.Module):
        def __init__(self, base: torch.nn.Module, lm_head: torch.nn.Module) -> None:
            super().__init__()
            self.base = base
            self.lm_head = lm_head

        def forward(
            self,
            input_ids: torch.Tensor,
            attention_mask: torch.Tensor,
            position_ids: torch.Tensor,
            past_kv: tuple,
        ) -> tuple:
            cache = DynamicCache()
            for layer_idx in range(n_layers):
                k = past_kv[layer_idx * 2]
                v = past_kv[layer_idx * 2 + 1]
                cache.update(k, v, layer_idx)
            outputs = self.base(
                input_ids=input_ids,
                attention_mask=attention_mask,
                position_ids=position_ids,
                past_key_values=cache,
                use_cache=True,
                return_dict=True,
            )
            logits = self.lm_head(outputs.last_hidden_state)
            out_kv = outputs.past_key_values
            flat = [logits]
            if hasattr(out_kv, "key_cache") and hasattr(out_kv, "value_cache"):
                for i in range(n_layers):
                    flat.append(out_kv.key_cache[i])
                    flat.append(out_kv.value_cache[i])
            elif hasattr(out_kv, "layers"):
                for layer in out_kv.layers:
                    flat.append(layer.keys)
                    flat.append(layer.values)
            elif hasattr(out_kv, "to_legacy_cache"):
                for layer_kv in out_kv.to_legacy_cache():
                    flat.append(layer_kv[0])
                    flat.append(layer_kv[1])
            else:
                for layer_kv in out_kv:
                    flat.append(layer_kv[0])
                    flat.append(layer_kv[1])
            return tuple(flat)

    lm_head = getattr(model, "lm_head", None) or getattr(text_model, "lm_head", None)
    if lm_head is None:
        sys.exit("Track B: could not locate lm_head on model or text_model")
    wrapper = MergedDecoderWrapper(text_model, lm_head).eval()

    batch = 1
    prefill_len = 4
    example_input_ids = torch.zeros((batch, prefill_len), dtype=torch.long)
    example_attention = torch.ones((batch, prefill_len), dtype=torch.long)
    example_positions = torch.arange(prefill_len, dtype=torch.long).unsqueeze(0)

    # Gemma 4 uses different head_dim per layer (sliding vs full attention).
    layer_types = getattr(text_config, "layer_types", None) or (
        ["sliding_attention"] * n_layers
    )
    global_head_dim = getattr(text_config, "global_head_dim", head_dim)
    per_layer_head_dim = [
        global_head_dim if layer_types[i] == "full_attention" else head_dim
        for i in range(n_layers)
    ]
    print(
        f"Track B: per_layer_head_dim summary - "
        f"sliding={head_dim}, full={global_head_dim}, "
        f"full_layer_count={sum(1 for d in per_layer_head_dim if d == global_head_dim)}",
        flush=True,
    )

    example_past: list[torch.Tensor] = []
    for layer_idx in range(n_layers):
        dim = per_layer_head_dim[layer_idx]
        example_past.append(torch.zeros((batch, n_kv_heads, 0, dim), dtype=torch.float32))
        example_past.append(torch.zeros((batch, n_kv_heads, 0, dim), dtype=torch.float32))
    example_past_tuple = tuple(example_past)

    from torch.export import Dim
    seq_dim = Dim("seq", min=1, max=131072)
    past_dim = Dim("past_seq", min=0, max=131072)
    total_dim = Dim("total_seq", min=1, max=131072)

    dynamic_shapes = (
        {0: None, 1: seq_dim},
        {0: None, 1: total_dim},
        {0: None, 1: seq_dim},
        tuple({0: None, 1: None, 2: past_dim, 3: None} for _ in range(2 * n_layers)),
    )

    input_names = ["input_ids", "attention_mask", "position_ids"]
    output_names = ["logits"]
    for layer_idx in range(n_layers):
        for kv_name in ("key", "value"):
            input_names.append(f"past_key_values.{layer_idx}.{kv_name}")
            output_names.append(f"present.{layer_idx}.{kv_name}")

    if decoder_path.exists():
        print(
            f"Track B: skipping torch.onnx.export — {decoder_path} already exists. "
            "Delete it to force a re-export.",
            flush=True,
        )
    else:
        torch.onnx.export(
            wrapper,
            (example_input_ids, example_attention, example_positions, example_past_tuple),
            str(decoder_path),
            input_names=input_names,
            output_names=output_names,
            dynamic_shapes=dynamic_shapes,
            opset_version=18,
            dynamo=True,
        )
        print("Track B: torch.onnx.export complete.", flush=True)

    # NOTE: A graph-optimization pass (`_optimize_graph`, using ORT's
    # `optimize_model` in `bert` mode) was tested between export and fp16 cast.
    # It either no-ops or makes things ~3% larger because Gemma 4's PLE /
    # interleaved attention isn't a recognized fusion pattern. Keeping the
    # function defined for future experiments but skipping it in the hot path.

    # Export the small embed-tokens graph before we free the PyTorch model.
    embed_intermediate = out_dir / "onnx" / "embed_tokens.onnx"
    embed_fp16 = out_dir / "onnx" / "embed_tokens_fp16.onnx"
    embed_path = out_dir / "onnx" / "embed_tokens_q4f16.onnx"
    print(f"Track B: exporting embed_tokens -> {embed_intermediate}...", flush=True)
    _export_embed_tokens(text_model, embed_intermediate)

    # Free the PyTorch model BEFORE any large ONNX cast/quant pass.
    # The fp16 caster loads the entire fp32 ONNX into memory + creates fp16
    # copies; on a 17 GB decoder that peaks near 30 GB and OOM-kills if the
    # PyTorch graph (another ~20 GB) is still resident.
    print("Track B: freeing PyTorch model before heavy ONNX passes...", flush=True)
    import gc
    del wrapper, text_model, model, tokenizer
    gc.collect()

    print("Track B: casting decoder fp32 -> fp16 ...", flush=True)
    decoder_fp16_path = out_dir / "onnx" / "decoder_model_merged_fp16.onnx"
    _cast_fp32_to_fp16(decoder_path, decoder_fp16_path)
    _delete_onnx_with_sidecars(decoder_path)
    gc.collect()

    print("Track B: quantizing decoder fp16 -> q4f16...", flush=True)
    quantized_path = out_dir / "onnx" / "decoder_model_merged_q4f16.onnx"
    _quantize_q4f16(decoder_fp16_path, quantized_path)
    _delete_onnx_with_sidecars(decoder_fp16_path)
    gc.collect()

    print(f"Track B: casting + quantizing embed_tokens -> {embed_path}...", flush=True)
    _cast_fp32_to_fp16(embed_intermediate, embed_fp16)
    _delete_onnx_with_sidecars(embed_intermediate)
    gc.collect()
    _quantize_q4f16(embed_fp16, embed_path)
    _delete_onnx_with_sidecars(embed_fp16)
    gc.collect()


def _extract_text_causal_lm(model):
    """Reach into a multimodal Gemma 4 wrapper for its text-only causal LM.

    Tries common attribute paths in order. Falls back to the model itself if no
    sub-tree is found (e.g. when AutoModelForCausalLM already gave us the
    text-only class directly).
    """
    candidates = (
        getattr(model, "language_model", None),
        getattr(model, "text_model", None),
        getattr(getattr(model, "model", None), "language_model", None),
    )
    for candidate in candidates:
        if candidate is not None:
            return candidate
    return model


def _extract_text_config(model, text_model):
    """Find the text-only config (Gemma4TextConfig) from various model layouts."""
    candidates = (
        getattr(text_model, "config", None),
        getattr(model.config, "text_config", None),
        model.config,
    )
    for candidate in candidates:
        if candidate is not None and hasattr(candidate, "num_hidden_layers"):
            return candidate
    raise RuntimeError(
        "Could not find a config exposing num_hidden_layers on this model."
    )


def _export_embed_tokens(model, out_path: Path) -> None:
    import torch

    class EmbedWrapper(torch.nn.Module):
        def __init__(self, embed: torch.nn.Module) -> None:
            super().__init__()
            self.embed = embed

        def forward(self, input_ids: torch.Tensor) -> torch.Tensor:
            return self.embed(input_ids)

    embed_module = (
        getattr(model, "get_input_embeddings", lambda: None)()
        or model.model.embed_tokens
    )
    wrapper = EmbedWrapper(embed_module).eval()

    example_ids = torch.zeros((1, 4), dtype=torch.long)
    torch.onnx.export(
        wrapper,
        (example_ids,),
        str(out_path),
        input_names=["input_ids"],
        output_names=["inputs_embeds"],
        dynamic_axes={
            "input_ids": {0: "batch", 1: "seq"},
            "inputs_embeds": {0: "batch", 1: "seq"},
        },
        opset_version=18,
        do_constant_folding=True,
        dynamo=False,
    )


def _delete_onnx_with_sidecars(path: Path) -> None:
    """Remove an ONNX file and its external-data sidecars (`.onnx.data` or
    `.onnx_data`) so we don't leave 10s of GB of intermediate fp32 weights."""
    path.unlink(missing_ok=True)
    Path(str(path) + ".data").unlink(missing_ok=True)
    (path.parent / (path.stem + ".onnx_data")).unlink(missing_ok=True)


def _optimize_graph(src: Path, dst: Path) -> None:
    """Run graph-level optimizations.

    onnxsim and onnxoptimizer both choke on >2 GB models because they
    round-trip through a single protobuf message (2 GB limit). We use
    `onnxruntime.transformers.optimizer.optimize_model` instead — it operates
    on the file path so it can read/write external data without ever
    serializing the whole model into one proto.
    """
    print(f"optimize: running ORT transformer optimizer on {src} ...", flush=True)
    try:
        from onnxruntime.transformers.optimizer import optimize_model
        from onnxruntime.transformers.fusion_options import FusionOptions
    except Exception as err:
        print(f"optimize: ORT optimizer unavailable ({err!r}); copying src to dst.",
              flush=True)
        _copy_onnx_with_sidecars(src, dst)
        return

    fusion_options = FusionOptions("bert")
    fusion_options.enable_gelu = True
    fusion_options.enable_layer_norm = True
    fusion_options.enable_attention = False  # Gemma-4 attention shape isn't BERT-like
    fusion_options.enable_skip_layer_norm = True
    fusion_options.enable_bias_skip_layer_norm = True
    fusion_options.enable_bias_gelu = True
    fusion_options.enable_qordered_matmul = False
    fusion_options.enable_shape_inference = False

    try:
        optimized = optimize_model(
            input=str(src),
            model_type="bert",
            num_heads=0,
            hidden_size=0,
            optimization_options=fusion_options,
            opt_level=1,
            use_gpu=False,
            only_onnxruntime=False,
        )
    except Exception as err:
        print(f"optimize: ORT optimize_model failed ({err!r}); copying src to dst.",
              flush=True)
        _copy_onnx_with_sidecars(src, dst)
        return

    location = dst.stem + ".onnx_data"
    (dst.parent / location).unlink(missing_ok=True)
    optimized.save_model_to_file(
        str(dst), use_external_data_format=True, all_tensors_to_one_file=True
    )
    print(f"optimize: wrote {dst}", flush=True)


def _copy_onnx_with_sidecars(src: Path, dst: Path) -> None:
    """Round-trip an ONNX model to a new path, rewriting external-data refs.

    Naive `shutil.copy2` would keep the location pointer in the .onnx
    metadata pointing at the *source* sidecar, which the caller is about to
    delete. Re-loading and re-saving emits a fresh location string that
    matches `dst`'s basename.
    """
    import onnx

    model = onnx.load(str(src), load_external_data=True)
    location = dst.stem + ".onnx_data"
    (dst.parent / location).unlink(missing_ok=True)
    onnx.save(
        model,
        str(dst),
        save_as_external_data=True,
        all_tensors_to_one_file=True,
        location=location,
        size_threshold=1024,
    )


def _cast_fp32_to_fp16(src: Path, dst: Path) -> None:
    """Cast all fp32 initializers in an ONNX model to fp16.

    Halves the file size before the q4 matmul pass runs. Delegates to the
    streaming caster (cast_fp16_streaming.py) in a subprocess: it walks
    initializers one at a time without loading the full graph into memory.
    On a 17 GB decoder, the in-memory onnxconverter_common approach peaked
    over 30 GB and OOM-killed the parent process.
    """
    script = Path(__file__).parent / "cast_fp16_streaming.py"
    print(f"fp16 cast: delegating to streaming caster for {src} ...", flush=True)
    subprocess.run(
        [sys.executable, str(script), "--src", str(src), "--dst", str(dst)],
        check=True,
    )
    print(f"fp16 cast: wrote {dst}", flush=True)


def _quantize_q4f16(src: Path, dst: Path) -> None:
    """Apply q4f16 weight-only quantization to a fp32/fp16 ONNX graph.

    onnxruntime renamed the 4-bit matmul quantizer several times; try the
    paths in order of recency. Output uses the transformers.js external-data
    naming convention (`<name>.onnx` + `<name>.onnx_data`).
    """
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
            print(f"q4f16: using {import_path}.{attr}", flush=True)
            break
        except (ImportError, AttributeError):
            continue

    if QuantizerCls is None:
        sys.exit(
            "Could not locate a 4-bit MatMul quantizer in onnxruntime. "
            "Tried matmul_nbits_quantizer.MatMulNBitsQuantizer and "
            "matmul_4bits_quantizer.MatMul4BitsQuantizer."
        )

    quantizer = QuantizerCls(
        model=str(src),
        block_size=32,
        is_symmetric=True,
        accuracy_level=4,
    )
    quantizer.process()

    onnx_model = (
        quantizer.model.model
        if hasattr(quantizer.model, "model")
        else quantizer.model
    )
    external_data_filename = dst.stem + ".onnx_data"
    # Remove any prior copy so save_model can overwrite cleanly.
    (dst.parent / external_data_filename).unlink(missing_ok=True)
    onnx.save_model(
        onnx_model,
        str(dst),
        save_as_external_data=True,
        all_tensors_to_one_file=True,
        location=external_data_filename,
        size_threshold=1024,
    )


def copy_runtime_configs(source_path: Path, out_dir: Path) -> None:
    print("Copying runtime configs...", flush=True)
    for name in RUNTIME_CONFIG_FILES:
        src = source_path / name
        if not src.exists():
            continue
        shutil.copy2(src, out_dir / name)


def validate_output(out_dir: Path) -> None:
    print("Validating output layout...", flush=True)
    for required in REQUIRED_OUTPUT_FILES:
        if not (out_dir / required).exists():
            sys.exit(f"missing required output file: {required}")

    for path in _walk(out_dir / "onnx"):
        rel = path.relative_to(out_dir).as_posix()
        for forbidden in FORBIDDEN_PREFIXES:
            if rel.startswith(forbidden):
                sys.exit(f"forbidden file present (vision/audio encoder leaked): {rel}")


def _walk(root: Path) -> Iterable[Path]:
    if not root.exists():
        return []
    return (p for p in root.rglob("*") if p.is_file())


def write_manifest(out_dir: Path, source_repo: str, track_used: str) -> dict:
    files = []
    for path in sorted(_walk(out_dir)):
        rel = path.relative_to(out_dir).as_posix()
        if rel == "export-manifest.json":
            continue
        files.append({"path": rel, "bytes": path.stat().st_size})

    manifest = {
        "sourceRepo": source_repo,
        "track": track_used,
        "dtype": "q4f16",
        "task": "text-generation-with-past",
        "transformersJsRepo": TRANSFORMERS_JS_REPO,
        "transformersJsPin": TRANSFORMERS_JS_PIN,
        "timestamp": dt.datetime.now(dt.timezone.utc).isoformat(),
        "files": files,
    }
    (out_dir / "export-manifest.json").write_text(json.dumps(manifest, indent=2))
    return manifest


def push_to_hub(out_dir: Path, target_repo: str) -> None:
    print(f"Uploading {out_dir} -> {target_repo}...", flush=True)
    from huggingface_hub import HfApi

    # Token is picked up from (in priority order): HF_TOKEN env var,
    # ~/.cache/huggingface/token, or `huggingface-cli login` cache.
    api = HfApi(token=os.environ.get("HF_TOKEN"))
    api.create_repo(repo_id=target_repo, exist_ok=True, private=False)
    api.upload_folder(
        folder_path=str(out_dir),
        repo_id=target_repo,
        commit_message="Text-only q4f16 ONNX export from merged-16bit fine-tune.",
    )
    print(f"Pushed: https://huggingface.co/{target_repo}", flush=True)


if __name__ == "__main__":
    main()
