"""Run the three WAVE production prompts through llama-cli against a local
GGUF and report whether output is coherent / schema-compliant.

Verifies whether the existing GGUF (built before the PEFT re-merge fix) is
broken via the same path that corrupted save_pretrained_merged.

Usage:
  python bench_gguf_wave_prompts.py <path-to-gguf>
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

LLAMA_CLI = Path("C:/Users/Bill/.unsloth/llama.cpp/build/bin/Release/llama-cli.exe")
PROMPTS_DIR = Path(__file__).resolve().parents[1] / "logs" / "wave-prompts"


def run_llama_cli(gguf: Path, system_text: str, user_text: str, max_new_tokens: int) -> tuple[str, float]:
    if not LLAMA_CLI.exists():
        sys.exit(f"missing: {LLAMA_CLI}")
    # llama-cli's --chat-template approach is brittle for Gemma 4 custom tokens;
    # use --in-prefix / --in-suffix and -no-cnv to pass an exact prompt string.
    # We construct the chat by hand to match Gemma's template.
    # Gemma 4 template (from our chat_template.jinja):
    #   <bos><|turn>system\n{system}<turn|>\n<|turn>user\n{user}<turn|>\n<|turn>model\n
    prompt = (
        f"<bos><|turn>system\n{system_text}<turn|>\n"
        f"<|turn>user\n{user_text}<turn|>\n"
        f"<|turn>model\n"
    )
    cmd = [
        str(LLAMA_CLI),
        "-m", str(gguf),
        "-p", prompt,
        "-n", str(max_new_tokens),
        "--no-conversation",
        "--temp", "0.0",  # greedy
        "--top-k", "1",
        "-c", "32768",
        "--no-display-prompt",
        "-no-cnv",
    ]
    started = time.time()
    result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    elapsed = time.time() - started
    if result.returncode != 0:
        print(f"  STDERR (last 500 chars): {result.stderr[-500:]}", flush=True)
        raise RuntimeError(f"llama-cli failed with code {result.returncode}")
    # Strip llama-cli framing
    out = result.stdout
    return out, elapsed


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("gguf", type=Path)
    args = ap.parse_args()

    if not args.gguf.exists():
        sys.exit(f"missing GGUF: {args.gguf}")

    for name in ("phase", "checkin", "reflection"):
        meta = json.loads((PROMPTS_DIR / f"{name}.json").read_text(encoding="utf-8"))
        print(f"\n=== {name} ===", flush=True)
        print(
            f"  system={len(meta['system'])} chars · user={len(meta['user'])} chars · max_new={meta['maxNewTokens']}",
            flush=True,
        )
        try:
            text, elapsed = run_llama_cli(args.gguf, meta["system"], meta["user"], meta["maxNewTokens"])
        except Exception as err:
            print(f"  FAILED: {err}", flush=True)
            continue
        stripped = text.strip()
        print(f"  raw len={len(stripped)} · {elapsed:.1f}s", flush=True)
        preview = stripped.replace("\n", " ")[:500]
        print(f"  output: {preview}{'...' if len(stripped) > 500 else ''}", flush=True)


if __name__ == "__main__":
    main()
