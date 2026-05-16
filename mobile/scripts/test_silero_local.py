"""
Local Silero VAD smoke test — runs the same ONNX model that the iOS app loads,
on a known-good speech sample, through the standard `onnxruntime` Python
package. Purpose: validate the tensor shapes / dtypes / sr value that the RN
wrapper uses BEFORE doing a 10-15 min EAS rebuild cycle.

If this script reports sensible probabilities on the test speech (peak > 0.7),
the ONNX file and our tensor-shape assumptions are correct and any "stays
at 0.002" symptom in the app is a React Native / onnxruntime-react-native /
Hermes-side bug. If even this script returns near-zero on speech, our
assumptions about the model I/O are wrong.

Usage (from repo root):
  models/.venv/Scripts/python mobile/scripts/test_silero_local.py
"""

from __future__ import annotations

import os
import struct
import sys
import urllib.request
import wave
from pathlib import Path
from typing import List

import numpy as np
import onnxruntime as ort


REPO_ROOT = Path(__file__).resolve().parents[2]
CACHE_DIR = REPO_ROOT / ".tmp" / "silero-local-test"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

# The exact ONNX file the mobile app downloads at runtime.
SILERO_URL = (
    "https://raw.githubusercontent.com/snakers4/silero-vad/master"
    "/src/silero_vad/data/silero_vad.onnx"
)
SILERO_PATH = CACHE_DIR / "silero_vad.onnx"

# Canonical 16 kHz test speech from the silero-vad repo's CI.
SPEECH_URL = (
    "https://raw.githubusercontent.com/snakers4/silero-vad/master"
    "/tests/data/test.wav"
)
SPEECH_PATH = CACHE_DIR / "test.wav"

SAMPLE_RATE = 16_000
FRAME_SAMPLES = 512  # 16 kHz: 32 ms hop.
CONTEXT_SAMPLES = 64  # Silero prepends the last 64 samples of the previous chunk.
STATE_LENGTH = 2 * 1 * 128
SPEECH_THRESHOLD = 0.5


def download(url: str, dest: Path) -> None:
    if dest.exists() and dest.stat().st_size > 0:
        return
    print(f"  downloading {url} -> {dest.name}")
    urllib.request.urlretrieve(url, dest)


def decode_wav(path: Path) -> tuple[np.ndarray, int]:
    """Decode 16-bit PCM WAV -> float32 in [-1, 1], plus sample rate."""
    with wave.open(str(path), "rb") as wf:
        channels = wf.getnchannels()
        sample_rate = wf.getframerate()
        sample_width = wf.getsampwidth()
        n_frames = wf.getnframes()
        raw = wf.readframes(n_frames)
    if sample_width != 2:
        raise RuntimeError(f"expected 16-bit PCM, got sampwidth={sample_width}")
    samples = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    if channels > 1:
        samples = samples.reshape(-1, channels).mean(axis=1)
    return samples, sample_rate


def run_silero(
    session: ort.InferenceSession,
    samples: np.ndarray,
    sample_rate: int,
    sr_shape: tuple[int, ...],
    label: str,
    with_context: bool = True,
) -> List[float]:
    """Frame-by-frame Silero inference.

    When `with_context=True` (the official wrapper's behavior), the input fed
    to the model is `[context_64 || chunk_512]` of shape (1, 576), where
    `context` is the last 64 samples of the previous chunk (zeros on the
    first call). This is the documented input format for Silero v5 at 16 kHz.

    When `with_context=False`, we feed plain 512-sample chunks — useful for
    confirming that's the broken path we were on.
    """
    if sample_rate != SAMPLE_RATE:
        raise RuntimeError(f"need 16 kHz audio, got {sample_rate}")

    state = np.zeros((2, 1, 128), dtype=np.float32)
    context = np.zeros(CONTEXT_SAMPLES, dtype=np.float32)
    if sr_shape == ():
        sr_arr = np.array(SAMPLE_RATE, dtype=np.int64)
    else:
        sr_arr = np.full(sr_shape, SAMPLE_RATE, dtype=np.int64)

    n_frames = len(samples) // FRAME_SAMPLES
    probs: List[float] = []
    for i in range(n_frames):
        chunk = samples[i * FRAME_SAMPLES : (i + 1) * FRAME_SAMPLES].astype(np.float32)
        if with_context:
            framed = np.concatenate([context, chunk]).reshape(1, CONTEXT_SAMPLES + FRAME_SAMPLES)
            context = chunk[-CONTEXT_SAMPLES:].copy()
        else:
            framed = chunk.reshape(1, FRAME_SAMPLES)
        outputs = session.run(
            None,
            {"input": framed, "state": state, "sr": sr_arr},
        )
        prob = float(outputs[0][0][0])
        state = outputs[1]
        probs.append(prob)

    print(f"\n[{label}] sr shape={sr_shape}, type={sr_arr.dtype}")
    print(f"  frames inferred: {len(probs)}")
    print(f"  peak prob:       {max(probs):.4f}")
    print(f"  mean prob:       {sum(probs) / max(1, len(probs)):.4f}")
    print(
        f"  frames > {SPEECH_THRESHOLD}:    "
        f"{sum(1 for p in probs if p >= SPEECH_THRESHOLD)} "
        f"({100 * sum(1 for p in probs if p >= SPEECH_THRESHOLD) / max(1, len(probs)):.1f}%)"
    )
    # Show a coarse timeline.
    binned = []
    bin_size = max(1, len(probs) // 60)
    for i in range(0, len(probs), bin_size):
        avg = sum(probs[i : i + bin_size]) / bin_size
        binned.append("#" if avg >= SPEECH_THRESHOLD else ".")
    print(f"  timeline:        {''.join(binned)}")
    return probs


def main() -> int:
    print("== Silero VAD local smoke ==")
    print(f"  cache: {CACHE_DIR}")
    download(SILERO_URL, SILERO_PATH)
    download(SPEECH_URL, SPEECH_PATH)
    print(f"  ONNX size:  {SILERO_PATH.stat().st_size:,} bytes")
    print(f"  speech wav: {SPEECH_PATH.stat().st_size:,} bytes")

    session = ort.InferenceSession(
        str(SILERO_PATH), providers=["CPUExecutionProvider"]
    )

    print("\n-- Model I/O --")
    for inp in session.get_inputs():
        print(f"  in  {inp.name}: {inp.type} shape={inp.shape}")
    for out in session.get_outputs():
        print(f"  out {out.name}: {out.type} shape={out.shape}")

    speech, sr = decode_wav(SPEECH_PATH)
    print(f"\nspeech: {len(speech)} samples ({len(speech) / sr:.2f}s) @ {sr} Hz")

    # Test 1: speech with the broken "no context" path (matches our buggy RN code).
    run_silero(
        session, speech, sr, sr_shape=(), label="SPEECH / no-context (broken)",
        with_context=False,
    )

    # Test 2: speech with the official 64-sample context prepend.
    run_silero(
        session, speech, sr, sr_shape=(), label="SPEECH / with context (fixed)",
        with_context=True,
    )

    # Test 3: silence with context — sanity check we get LOW probabilities.
    silence = np.zeros(sr * 3, dtype=np.float32)
    run_silero(
        session, silence, sr, sr_shape=(), label="SILENCE / with context",
        with_context=True,
    )

    print("\n== Interpretation ==")
    print("  - If SPEECH peak > 0.7  -> model + assumptions are correct.")
    print("  - If SPEECH peak ~0.002 -> our shape/dtype assumptions are wrong.")
    print("  - SILENCE should stay below ~0.3 in all variants.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
