# Silero VAD on iPhone — what shipped and how we got there

**Status:** Live mic VAD working on physical iPhone. Production wrapper at
`mobile/src/voice/silero-vad.ts`, test screen at
`mobile/src/screens/VadTestScreen.tsx`, local smoke at
`mobile/scripts/test_silero_local.py`.

**Stack:** `onnxruntime-react-native@1.24.3` (Silero v5 ONNX inference,
runtime-downloaded) + `react-native-sherpa-onnx@0.4.3`
`createPcmLiveStream` (16 kHz mono float32 mic capture).

---

## What we ended up with

1. **Model id:** `silero-vad` registered in `mobile/src/runtime/model-cache.ts`
   — 2.3 MB ONNX downloaded at runtime from
   `github.com/snakers4/silero-vad/raw/master/src/silero_vad/data/silero_vad.onnx`
   into `Documents/wave-models/silero-vad/`. Cache-panel UI re-uses the
   same plumbing as the LiteRT and Whisper bundles.
2. **Inference:** `onnxruntime-react-native`'s `InferenceSession.create`
   opens the ONNX on iOS via the standard CoreML/CPU backends. Plain CPU is
   plenty for a 2 MB model running at ~30 fps (32 ms hop).
3. **Mic capture:** sherpa-onnx's `createPcmLiveStream({ sampleRate: 16000,
   channelCount: 1 })`. Sherpa already shipped because of Kokoro TTS, so the
   new dep count for VAD is zero. The stream emits arbitrary-sized base64
   Int16 chunks; we drain them through a ring buffer into 512-sample
   (32 ms) frames.
4. **Hysteresis:** enter "speech" state at `p ≥ 0.5` for 3 consecutive
   frames (~96 ms), leave after `p < 0.35` for 22 consecutive frames
   (~700 ms). Mirrors the "normal" sensitivity mode from
   `client/lib/voice/vad-listener.ts`.
5. **UI:** big circle indicator (green = speech, gray = silent) +
   probability number + rolling 3-second probability timeline. The screen
   doubles as the diagnostic harness — peak audio magnitude, frames
   inferred, peak probability are surfaced so a future debug session
   doesn't have to instrument from scratch.

## Lessons worth keeping

### Silero v5's input is 576 samples, not 512 — and the README does not say so

This was the only real blocker, and it cost us most of the debugging time.
The official Silero readme and the snakers4 examples all say "feed
512-sample frames at 16 kHz." That's only half the story. The actual model
input is shape `[1, 576]` = **64 samples of context + 512 samples of new
audio**, where the 64 context samples are the trailing 64 samples of the
*previous* chunk (zeros on the first call). You only see this if you read
the Python wrapper's `OnnxWrapper.__call__` in `utils_vad.py`:

```python
context_size = 64 if sr == 16000 else 32
if not len(self._context):
    self._context = torch.zeros(batch_size, context_size)
x = torch.cat([self._context, x], dim=1)   # ← shape becomes [1, 576]
# ... session.run ...
self._context = x[..., -context_size:]
```

Without the context prepend, the model silently runs to completion on the
512-sample input and emits **~0.001 on everything** — silence and shouted
speech alike. There is no error, no shape mismatch, no log. The symptom is
"VAD never fires."

Once we matched the official input format, peak probability on a
known-good speech sample went from 0.0077 to 1.0000 (77% of frames
detected as speech).

**Takeaway:** for any open-source ONNX wrapper that has a non-trivial
input pre-processing step, **read the reference Python implementation,
not the readme.** README-level docs always under-specify the real input
contract.

### The local Python smoke saved us a 10-minute EAS rebuild loop

Debugging this on-device meant: edit JS → `eas build --profile development
--platform ios` (10-15 min) → install IPA → launch dev client →
reproduce. Even with the JS hot-reload working for non-native changes,
each "is the tensor shape right?" iteration was 15+ minutes.

After ~3 of those, we wrote `mobile/scripts/test_silero_local.py`. It
downloads the exact ONNX file + a known-good speech sample from the
silero-vad repo's CI, and runs the model through stock Python
`onnxruntime` with the same tensor shapes the JS wrapper uses. That
iteration loop became **15 seconds**. Within two runs of the local
script, we'd narrowed the bug to "input length is wrong" and confirmed
the 576-sample context fix worked — *before* touching the iOS build.

**Takeaway:** when wiring any ONNX model into React Native, write the
Python equivalent first (or alongside). The dev loop delta is two orders
of magnitude. The script lives at `mobile/scripts/test_silero_local.py`
and remains useful as a regression check for future wrapper changes.

### Things that looked like the bug but weren't

We chased a few false leads before finding the real cause. Recording
these so the next person doesn't repeat them:

- **`sr` tensor as `[1]` vs `[]` scalar.** Silero's metadata declares `sr`
  as a scalar (`shape=[]`). Some ORT backends silently broadcast `[1]`
  tensors to scalars, others don't, so we matched the declared shape to
  be safe. But sr-shape was not the bug — the local Python script
  produced identical garbage on both shapes.
- **Hermes BigInt64Array marshaling.** Plausible: Hermes has had bugs
  where BigInt64Array's underlying buffer doesn't hold the int64 bytes
  the native side expects. We worked around it with
  `DataView.setBigInt64`, which is a direct byte-write. Defensive but
  not the bug — Python via numpy int64 gave the same wrong outputs.
- **iOS audio session not set up for recording.** Real, separate bug,
  fixed by `setAudioModeAsync({ playsInSilentMode: true, allowsRecording:
  true })`. The Whisper and VAD test screens both needed this; the
  combined screen had it already.

### Sherpa-onnx's live PCM stream is the right capture path on RN

`expo-audio` only writes recordings to files, with no live PCM callback.
We started with a record-then-decode flow that batch-analyzed the WAV
after the user pressed Stop — workable but obviously not "real time."
Switching to sherpa's `createPcmLiveStream` gave us continuous 16 kHz
float32 frames via a DeviceEventEmitter callback. **Sherpa was already a
dep for Kokoro TTS**, so the swap was zero new native modules.

This also matters for the upcoming combined-loop wiring: the same stream
can simultaneously feed VAD (for barge-in detection) and a buffer that
gets flushed to Whisper on speech-end.

## Constants worth knowing

| | 16 kHz | 8 kHz |
|---|---|---|
| Chunk samples | 512 | 256 |
| Context samples | 64 | 32 |
| Total input length | **576** | 288 |
| Frame duration | 32 ms | 32 ms |
| State shape | `[2, 1, 128]` | `[2, 1, 128]` |
| sr tensor | int64 scalar = 16000 | int64 scalar = 8000 |

The wrapper only supports 16 kHz today (`VAD_SAMPLE_RATE = 16000`); 8 kHz
would need a runtime-selectable `CONTEXT_SAMPLES`. Not planned.

## Pointers

- Wrapper: `mobile/src/voice/silero-vad.ts`
- Test screen: `mobile/src/screens/VadTestScreen.tsx`
- Route: `mobile/app/tests/vad.tsx`
- Local smoke: `mobile/scripts/test_silero_local.py`
- Cache entry: `mobile/src/runtime/model-cache.ts` → `silero-vad`
- Silero reference impl:
  `https://github.com/snakers4/silero-vad/blob/master/src/silero_vad/utils_vad.py`
  (the only doc that mentions the 64-sample context buffer)
