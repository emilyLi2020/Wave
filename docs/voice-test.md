# WAVE - Voice Test Stack

> Developer-only reference for the on-device voice loop test at
> [`/models/voice-test`](../client/app/models/voice-test/). This page validates
> the on-device STT → LLM → TTS pipeline, hands-free VAD, and TTS interruption
> stack before any of it gets wired into the patient-facing session flow.

## Scope

The voice-test page is a functionality test surface, not the production
session. It lives under `/models/voice-test` (with the rest of the
browser-runtime model probes) and starts with a mocked WAVE check-in scenario
so the team can test realistic voice behavior without changing `/session`.

The mocked check-in context lives in
[`client/lib/gemma/voice-test.ts`](../client/lib/gemma/voice-test.ts) and is
injected into the wllama Gemma runtime through `generateVoiceTestReply()`. The
mock includes intake intensity, current score, medication status, trigger,
prior chunk context, and the next phase. It is for developer validation only.

## Runtime Stack

| Stage | Module | Backend |
|-------|--------|---------|
| STT   | [`client/lib/voice/stt-whisper.ts`](../client/lib/voice/stt-whisper.ts) | `@huggingface/transformers`, default `onnx-community/whisper-base.en` (tiny.en also selectable) |
| LLM   | [`client/lib/gemma/voice-test.ts`](../client/lib/gemma/voice-test.ts) → [`client/lib/wllama/`](../client/lib/wllama/) | `@wllama/wllama` 3.1.1, WAVE fine-tune GGUF (`Maelstrome/lora-wave-session-r32`), streaming `createChatCompletion` |
| TTS primary | [`client/lib/voice/tts-kokoro.ts`](../client/lib/voice/tts-kokoro.ts) | `kokoro-js` running `onnx-community/Kokoro-82M-v1.0-ONNX`, default `fp32 + WebGPU` |
| TTS fallback | [`client/lib/voice/tts-browser.ts`](../client/lib/voice/tts-browser.ts) | Browser `speechSynthesis`, local voices only |
| VAD   | [`client/lib/voice/vad-listener.ts`](../client/lib/voice/vad-listener.ts) | `@ricky0123/vad-web` Silero v5 via ONNX Runtime Web |
| Orchestrator | [`client/app/models/voice-test/voice-test-client.tsx`](../client/app/models/voice-test/voice-test-client.tsx) | Wires mic → Whisper → wllama → Kokoro/browser, hands-free, interruptions, transcript, debug |

Silero VAD assets are self-hosted from `client/public/vendor/vad/`, not pulled
from a CDN. After dependency installs/upgrades, run `pnpm prepare:vad-assets`
from `client/` to refresh:

- `vad.worklet.bundle.min.js`
- `silero_vad_legacy.onnx`
- `silero_vad_v5.onnx`
- ONNX Runtime Web `ort-wasm*.wasm` and `ort-wasm*.mjs` files

## LLM: wllama (GGUF), not ONNX

The voice-test page runs the WAVE fine-tune through `@wllama/wllama` rather
than `transformers.js` + onnxruntime-web. The clinical session flow still uses
ONNX Gemma via [`client/lib/gemma/local-runtime.ts`](../client/lib/gemma/local-runtime.ts);
they are intentionally on different engines so the test page can validate the
wllama path independently.

Load + generate surface in [`client/lib/gemma/voice-test.ts`](../client/lib/gemma/voice-test.ts):

- `preloadVoiceTestLlm()` — singleton loader, calls `loadWaveWllama()` once and
  tracks state through `subscribeVoiceTestLlmLoad()`/`getVoiceTestLlmLoadState()`.
- `generateVoiceTestReply({ history, signal, onDelta })` — streams the reply
  via `wllama.createChatCompletion({ stream: true, abortSignal, onData })` and
  fires `onDelta(accumulated)` for each chunk so Kokoro's
  streaming-sentence path can decode in parallel.

### Chat-template gotcha

The mock check-in seeds the visible transcript with an assistant opener for
UX, but Gemma's chat template rejects message lists that don't strictly
alternate `user` → `assistant` → `user`. `dropLeadingAssistant()` strips any
leading assistant turn(s) before handing history to wllama; the opener is
still in the system prompt's `<mock_session_context>` so the model knows it
was said. Without this, every first turn fails with:

```
Jinja Exception: Conversation roles must alternate user/assistant/user/assistant/...
```

### Mobile preset

`loadWaveWllama()` auto-detects mobile UAs and probes WebGPU at runtime. On
mobile + WebGPU it keeps `n_ctx=4096` with f16 KV. On mobile without WebGPU
it forces WASM, drops KV to `q8_0`, and turns on `flash_attn` so the 3.2 GB
Q4_K_M weights fit alongside the KV cache in iOS Safari's ~2 GiB WASM heap.
See [`client/lib/wllama/client.ts`](../client/lib/wllama/client.ts) for
details.

`swa_full: true` is set globally to dodge the llama.cpp SWA-cache crash
(ggml-org/llama.cpp#20277) that trips when WAVE prompts exceed the SWA window.
Costs ~250 MiB extra KV memory.

## Kokoro Runtime Options

Defined in [`client/lib/voice/types.ts`](../client/lib/voice/types.ts).

| Runtime | Notes |
|---------|-------|
| `fp32-webgpu` (default) | Audible on every WebGPU-capable browser we've tested. |
| `fp16-webgpu` | Faster but **silent on some NVIDIA WebGPU drivers** (observed: NVIDIA Blackwell on Windows). The model runs, the WAV blob is the right size, but the float samples are all zero — fp16 inference is producing NaN values that get clamped during WAV encoding. |
| `q8-webgpu`, `q4f16-webgpu`, `q4-webgpu` | Experimental, audible artifacts at lower quantizations. |
| `q8-wasm` | CPU fallback for environments without WebGPU. |

Kokoro model instances are cached per runtime id in `tts-kokoro.ts`, so the
page can switch between runtimes without confusing loaded states. Expected
ONNX Runtime provider-assignment warnings are filtered during Kokoro load
because they are benign for this path and otherwise show up as noisy
developer-console errors.

## Streaming TTS Path

The preferred path streams wllama deltas into Kokoro and streams generated
audio chunks out for playback:

1. `voice-test-client.tsx` creates an `AsyncTextChunkStream`.
2. wllama's `onDelta(accumulated)` callback diffs against the previously seen
   text and pushes the new tail into the chunk stream.
3. `tts-kokoro.ts` passes the text stream into Kokoro's native
   `TextSplitterStream` when available.
4. `tts.stream()` generates audio chunks as Kokoro decides text boundaries.
5. Chunks are queued and played in order.

If Kokoro's native stream API is unavailable, `tts-kokoro.ts` falls back to
the manual `SentenceChunkBuffer` path. Runtime debug shows whether the last
turn used `native-kokoro-stream` or `manual-sentence-chunks`.

## Hands-Free Flow

Hands-free is the conversational mode. Manual `Start talking / Stop and
transcribe` remains as a single-turn capture path.

Entering hands-free:

1. Create the long-lived `MicVAD` listener if it doesn't exist yet.
2. If Kokoro is the TTS backend, ensure it's preloaded so the opener doesn't
   sit silent while the model lazy-loads.
3. **Speak the mock-check-in opener through Kokoro** (once per conversation,
   reset by the Reset button). VAD stays paused for this so the opener isn't
   captured as a patient turn.
4. Transition phase to `listening` and `resume("normal")` the VAD listener.

The input-level meter updates live whenever hands-free is enabled (not just
during an active recording). This is what makes the page feel responsive
while you wait for VAD to confirm speech start.

`vad-listener.ts` lazy-loads `@ricky0123/vad-web`, creates a Silero `MicVAD`
with `model: "v5"`, `baseAssetPath: "/vendor/vad/"`, and
`onnxWASMBasePath: "/vendor/vad/"`, then emits:

- `onLevel` — RMS/peak, Silero speech probability, active probability
  threshold, and a noise-floor estimate.
- `onSpeechStart` — normal speech start.
- `onSpeechEnd` — normal speech audio. Manual, hands-free, and interruption
  turns all transcribe Silero's returned mono 16 kHz `Float32Array`; the page
  no longer starts a separate `MediaRecorder` capture.
- `onSpeechMisfire` — speech detected but shorter than Silero's `minSpeechMs`
  gate.
- `onInterruptionStart` — accepted barge-in during TTS.
- `onInterruptionEnd` — barge-in audio, routed through the same Silero-audio
  submission path as every other turn.
- `onInterruptionIgnored` — rejected interruption candidates.

While the page is `thinking`, `transcribing`, or `warming`, the listener is
paused so we don't catch our own TTS or capture audio mid-transition.

## Interruption Detection

Interruption detection is intentionally separate from normal hands-free
speech start. It only runs when all of these are true:

- Hands-free mode is enabled.
- Barge-in is enabled.
- The page status is `speaking`, or streamed TTS playback is active.
- The initial TTS grace period has elapsed.

When those conditions are met, the VAD listener resumes in `interruption`
mode, which uses stricter criteria than normal speech (all in
[`client/lib/voice/vad-listener.ts`](../client/lib/voice/vad-listener.ts)):

- Higher Silero positive speech threshold (`0.45` vs `0.30`).
- Longer `minSpeechMs` gate before firing (`380` vs `240`).
- Minimum peak level (`0.035`).
- Rolling recent-level history so the detector requires a sharp rise above
  the recent floor.
- Suppression window after TTS audio starts playing, because speaker output
  can spike the microphone immediately.

TTS playback lifecycle events come from both Kokoro and browser speech:

- Kokoro full-response playback emits start/end around the single audio
  object.
- Kokoro streaming playback emits start/end for each generated audio chunk.
- Browser speech emits start/end around the `SpeechSynthesisUtterance`.

The page uses those lifecycle events to call `markAudioOutput()` on the VAD
listener, which temporarily suppresses interruption detection after every
TTS chunk start.

When an interruption is accepted, `voice-test-client.tsx`:

1. Stops Kokoro/browser TTS immediately.
2. Closes the active text chunk stream.
3. Aborts the in-flight wllama `createChatCompletion` via its `AbortSignal`,
   which `createCompletionImpl` honors and throws `WllamaAbortError`.
4. Invalidates the active generation token through the voice turn machine so
   stale wllama deltas can't keep updating the visible streaming bubble.
5. Commits any visible partial assistant draft as an interrupted transcript
   turn, then clears the live draft before the user's barge-in is
   transcribed.
6. Shows the recording state while Silero continues the accepted speech
   segment.
7. Sends Silero's returned 16 kHz `Float32Array` audio to Whisper when speech
   ends.

If the interruption audio is too short or Whisper returns empty text, the
page treats it as a false interrupt, returns to idle, and shows a warning
rather than adding an empty user turn to the transcript.

## Debug UI

The runtime debug panel shows:

- Hands-free on/off.
- VAD state.
- VAD RMS, active Silero probability threshold, Silero speech probability,
  and noise floor.
- Interruption status: `idle`, `armed`, `suppressed`, `detected`, or
  `ignored`.
- Interruption speech probability.
- Last ignored reason: `audio output suppression`, `low peak`, or `no recent
  rise`. Silero misfires are surfaced through this same ignored-interruption
  path instead of being silent.
- Stream mode and streaming TTS status.
- Voice phase and the recent voice event log (`vad_speech_start`,
  `vad_speech_end`, `interrupt_detected`, `gemma_abort`, `tts_chunk_start`,
  `stt_done`, and related events).
- Last turn timing for audio, STT, first wllama token, first audio, Gemma,
  TTS, total time, chunk count, playback mode, and fallback use.

## Known Issues and Workarounds

| Issue | Symptom | Workaround |
|-------|---------|------------|
| Kokoro `fp16-webgpu` silent on NVIDIA Blackwell + Windows Chrome | Page reports `firstAudio=...ms warning=(none)` but you hear nothing; decoded buffer is all zeros | Default flipped to `fp32-webgpu`. Pick a non-fp16 runtime in the config panel if you switched manually. |
| Whisper `tiny.en` mistranscribes during conversational speech | Wildly wrong patient-turn transcripts | Default flipped to `whisper-base.en`. Tiny is still selectable for latency benchmarks. |
| Gemma chat template rejects leading-assistant message lists | `Jinja Exception: Conversation roles must alternate...` thrown by wllama | `dropLeadingAssistant()` in `lib/gemma/voice-test.ts` strips the synthetic opener turn before sending to wllama. |
| llama.cpp SWA cache crash on long prompts (#20277) | wllama aborts on the second `createChatCompletion` when prompts share little prefix | `swa_full: true` is set in `loadWaveWllama()` — costs ~250 MiB extra KV memory. |

## Verification

Run from `client/` after changing this stack:

```bash
pnpm prepare:vad-assets
pnpm exec tsc --noEmit
pnpm build
```

Manual browser checks for `/models/voice-test`:

1. Click **Warm models** — wait for Whisper, wllama, and Kokoro to all show
   `ready` in the runtime panel.
2. Click **Start hands-free** — you should hear the opener: *"How intense is
   the craving now, rate from 1 to 10?"*
3. Answer with a score; confirm Whisper transcribes correctly and wllama
   produces a coherent assistant reply through Kokoro.
4. Speak over Kokoro mid-reply; confirm playback stops and recording starts.
5. Try short noises or coughs; confirm they are ignored unless sustained.
6. Confirm manual **Start talking** still works for single-turn capture.
7. Click **Reset** to verify the opener fires again on the next hands-free
   start.

Do not add automated tests that download wllama, Whisper, or Kokoro model
weights in CI. Unit tests should mock the `client/lib/gemma/*`,
`client/lib/wllama/*`, and `client/lib/voice/*` boundaries.
