# WAVE - Voice Test Stack

> Developer-only reference for the isolated conversational voice test page at
> `client/app/training/voice-test/`. This page validates the on-device STT,
> Gemma, TTS, hands-free VAD, and interruption stack before any of it is wired
> into the patient-facing session flow.

## Scope

The voice test page is a functionality test surface, not the production session.
It is intentionally kept under `/training/voice-test` and starts with a mocked
WAVE check-in scenario so the team can test realistic voice behavior without
changing `/session`.

The mocked check-in context lives in `client/lib/gemma/voice-test.ts` and is
passed into the local Gemma runtime through `generateVoiceTestReply()`. The
mock includes intake intensity, current score, medication status, trigger,
prior chunk context, and the next phase. It is for developer validation only.

## Runtime Stack

- STT: `client/lib/voice/stt-whisper.ts` runs Whisper through
  `@huggingface/transformers`, currently selecting between
  `onnx-community/whisper-tiny.en` and `onnx-community/whisper-base.en`.
- LLM: `client/lib/gemma/local-runtime.ts` runs the existing local Gemma path.
  The voice test uses `generateGemmaVoiceTestTurn()` with a mock check-in system
  prompt, streamed deltas, and abort support.
- TTS primary: `client/lib/voice/tts-kokoro.ts` runs
  `onnx-community/Kokoro-82M-v1.0-ONNX` through `kokoro-js`.
- TTS fallback: `client/lib/voice/tts-browser.ts` uses browser
  `speechSynthesis`, but only with voices that report local service support.
- VAD: `client/lib/voice/vad-listener.ts` wraps `@ricky0123/vad-web`
  `MicVAD`, which runs Silero VAD locally through ONNX Runtime Web.
- UI orchestrator: `client/app/training/voice-test/voice-test-client.tsx`
  coordinates mic capture, Whisper, Gemma, Kokoro/browser TTS, hands-free VAD,
  interruption detection, transcript state, and debug output.

Silero VAD assets are self-hosted from `client/public/vendor/vad/`, not loaded
from a CDN. Run `pnpm prepare:vad-assets` from `client/` after dependency
installs or upgrades to refresh the local copies of:

- `vad.worklet.bundle.min.js`
- `silero_vad_legacy.onnx`
- `silero_vad_v5.onnx`
- ONNX Runtime Web `ort-wasm*.wasm` and `ort-wasm*.mjs` files

## Kokoro Runtime Options

The Kokoro runtime options are defined in `client/lib/voice/types.ts`.

- `fp32-webgpu` is the default for the test page. It is intended to reduce
  generation gaps between spoken chunks on browsers with WebGPU.
- `q8-wasm` remains the compatibility fallback and is selected automatically
  when WebGPU is unavailable.

Kokoro model instances are cached per runtime id in `tts-kokoro.ts`, so the page
can switch between WebGPU and WASM without confusing the two loaded states.
Expected ONNX Runtime provider-assignment warnings are filtered during Kokoro
load because they are benign for this path and otherwise show up as noisy
developer-console errors.

## Streaming TTS Path

The preferred path streams Gemma deltas into Kokoro and streams generated audio
chunks out for playback:

1. `voice-test-client.tsx` creates an `AsyncTextChunkStream`.
2. Gemma `onDelta` pushes raw text deltas into that stream.
3. `tts-kokoro.ts` passes the text stream into Kokoro's native
   `TextSplitterStream` when available.
4. `tts.stream()` generates audio chunks as Kokoro decides text boundaries.
5. Chunks are queued and played in order.

If Kokoro's native stream API is unavailable, `tts-kokoro.ts` falls back to the
manual `SentenceChunkBuffer` path. Runtime debug shows whether the last turn used
`native-kokoro-stream` or `manual-sentence-chunks`.

## Hands-Free VAD

`client/lib/voice/vad-listener.ts` owns the always-listening VAD used by
hands-free mode. It lazy-loads `@ricky0123/vad-web`, creates a Silero `MicVAD`
with `model: "v5"`, `baseAssetPath: "/vendor/vad/"`, and
`onnxWASMBasePath: "/vendor/vad/"`, then emits:

- `onLevel` for debug RMS/peak, Silero speech probability, active probability
  threshold, and a best-effort noise-floor estimate.
- `onSpeechStart` for normal speech start and recording-meter state.
- `onSpeechEnd` for normal speech audio. Manual, hands-free, and interruption
  turns all transcribe Silero's returned mono 16 kHz `Float32Array`; the page no
  longer starts a separate `MediaRecorder` capture.
- `onSpeechMisfire` for speech that was detected but shorter than Silero's
  `minSpeechMs` gate.
- `onInterruptionStart` for explicit barge-in during TTS.
- `onInterruptionEnd` for accepted barge-in audio, routed through the same
  Silero-audio submission path as every other turn.
- `onInterruptionIgnored` for rejected interruption candidates.

Hands-free mode is controlled by the action button next to `Start talking`; it
is not hidden in the stack settings panel. Normal hands-free detection should
only start turns while the page is idle. Manual capture also uses the same
long-lived `MicVAD`; clicking stop asks Silero to flush the active speech segment
with `submitUserSpeechOnPause` instead of stopping a browser recorder. During
thinking/transcribing/warming it is paused.

## Interruption Detection

Interruption detection is intentionally separate from normal hands-free speech
start. It only runs when all of these are true:

- Hands-free mode is enabled.
- Barge-in is enabled.
- The page status is `speaking`, or streamed TTS playback is active.
- The initial TTS grace period has elapsed.

When those conditions are met, the VAD listener resumes in `interruption` mode.
This mode uses stricter criteria than normal speech, now based on Silero
probability instead of an RMS threshold:

- A higher Silero positive speech threshold.
- A longer `minSpeechMs` gate before firing.
- A minimum peak level.
- A short rolling recent-level history so the detector requires a sharp rise
  above the recent floor.
- Suppression windows after TTS audio starts playing, because speaker output can
  spike the microphone immediately.

TTS playback lifecycle events come from both Kokoro and browser speech:

- Kokoro full-response playback emits start/end around the single audio object.
- Kokoro streaming playback emits start/end for each generated audio chunk.
- Browser speech emits start/end around the `SpeechSynthesisUtterance`.

The page uses those lifecycle events to call `markAudioOutput()` on the VAD
listener. That temporarily suppresses interruption detection after every TTS
chunk start.

When an interruption is accepted, `voice-test-client.tsx`:

1. Stops Kokoro/browser TTS immediately.
2. Closes the active text chunk stream.
3. Interrupts the active Transformers.js generation with
   `InterruptableStoppingCriteria`.
4. Invalidates the active generation token through the voice turn machine so stale Gemma deltas cannot keep
   updating the visible streaming bubble.
5. Commits any visible partial assistant draft as an interrupted transcript turn,
   then clears the live draft before the user's barge-in is transcribed.
6. Shows the recording state while Silero continues the accepted speech segment.
7. Sends Silero's returned 16 kHz `Float32Array` audio to Whisper when speech
   ends.

If the interruption audio is too short or Whisper returns empty text, the
page treats it as a false interrupt, returns to idle, and shows a warning rather
than adding an empty user turn to the transcript.

## Debug UI

The runtime debug panel shows:

- Hands-free on/off.
- VAD state.
- VAD RMS, active Silero probability threshold, Silero speech probability, and
  best-effort noise floor.
- Interruption status: `idle`, `armed`, `suppressed`, `detected`, or `ignored`.
- Interruption speech probability.
- Last ignored reason: `audio output suppression`, `low peak`, or
  `no recent rise`. Silero misfires are surfaced through this same ignored
  interruption path instead of being silent.
- Stream mode and streaming TTS status.
- Voice phase and the recent voice event log (`vad_speech_start`,
  `vad_speech_end`, `interrupt_detected`, `gemma_abort`, `tts_chunk_start`,
  `stt_done`, and related events).
- Last turn timing for audio, STT, first Gemma token, first audio, Gemma, TTS,
  total time, chunk count, playback mode, and fallback use.

## Verification

Run from `client/` after changing this stack:

```bash
pnpm prepare:vad-assets
pnpm exec tsc --noEmit
pnpm build
```

Manual browser checks for `/training/voice-test`:

1. Enable hands-free and barge-in.
2. Let Kokoro speak without talking; confirm it does not self-trigger from its
   own audio.
3. Speak over Kokoro; confirm playback stops and recording starts.
4. Try short noises or coughs; confirm they are ignored unless sustained.
5. Confirm manual `Start talking` still works.
6. Confirm normal hands-free turn detection still works when TTS is idle.

Do not add automated tests that download Gemma, Whisper, or Kokoro model weights
in CI. Unit tests should mock the `client/lib/gemma/*` and `client/lib/voice/*`
boundaries.
