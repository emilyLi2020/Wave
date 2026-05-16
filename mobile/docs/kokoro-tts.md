# Kokoro TTS on iPhone — what shipped and how we got there

**Status:** Complete success. Production wiring at
`mobile/src/screens/CombinedVoiceTestScreen.tsx`; A/B harness for future
regression testing at `mobile/src/screens/KokoroTestScreen.tsx`.

**Stack:** `react-native-sherpa-onnx@0.4.3` + `@dr.pogodin/react-native-fs`
+ Kokoro `kokoro-en-v0_19` (fp32, 304 MB) via streaming PCM playback on
sherpa's native audio queue.

---

## What we ended up with

1. **Model id:** `kokoro-en-v0_19` (English-only, fp32, 304 MB compressed).
   Pulled at runtime from the `k2-fsa/sherpa-onnx` GitHub releases tag
   `tts-models` via sherpa's `ensureModelByCategory` into
   `Documents/sherpa-onnx/models/tts/`. Resumes on relaunch.
2. **Engine:** `createStreamingTTS({ modelPath: { type: 'file', path },
   modelType: 'kokoro', providers: ['CoreMLExecutionProvider'] })`.
3. **Playback:** sherpa's built-in native PCM player — `startPcmPlayer(sr,
   1)` → `writePcmChunk(samples)` per `onChunk` → `stopPcmPlayer()` *after
   waiting for the queue to drain*. No temp WAV files, no expo-audio
   round-trip.
4. **Streaming granularity:** per-sentence. Sherpa splits input into
   sentences and emits each one's PCM as soon as the model finishes that
   forward pass. Kokoro isn't autoregressive over audio frames, so
   within-sentence streaming is impossible for any on-device TTS today
   (this is a model-architecture fact, not a library limitation).

## Lessons worth keeping

### Apple Silicon CoreML EP favors fp32 over int8 for arbitrary ONNX

Empirically confirmed on iPhone with all four Kokoro variants. fp32 EN
v0.19 had **both** the lowest TTFB **and** the cleanest audio — a result
that runs against CUDA/x86 intuition where int8 is reliably faster. The
cause is that CoreML has no general int8 fast-path; the ANE and AMX
matrix coprocessor have dedicated fp16/fp32 SIMD paths, and int8
operators fall back to scalar CPU with quant/dequant noise at every
layer boundary. For any future on-device ONNX model on iOS, **start
with fp32 and only fall back to int8 if size forces it.**

### Vendor model registries use underscores, not dots

`kokoro-en-v0_19` not `kokoro-en-v0.19`. The dot is what humans write;
the actual GitHub release asset filename is `kokoro-en-v0_19.tar.bz2`.
Sherpa strips `.tar.bz2` to derive the id. The old
`scripts/download-kokoro.sh` had the dot version baked in — that URL
would have 404'd if anyone had run it. **When wiring a registry lookup,
fetch the live release list once via `gh api` and copy the literal asset
name.**

### v0.19 int8 has a high-pitch quantization artifact; v1.1 fixed it

If size forces you to int8 someday, use `kokoro-int8-multi-lang-v1_1`
(140 MB), not the v0.19 variant. v0.19's int8 quant produces a
consistent high-pitch ringing during voiced segments — classic
quantization noise getting modulated up into audible frequencies during
the vocoder pass. v1.1 redid the calibration with better per-channel
scales and the artifact is gone. v1.1 is also multilingual at the same
compute cost (Kokoro is 82M params regardless of variant).

## The journey (chronological)

This took longer than it should have. Documenting the wrong turns so the
next time someone wires an on-device model they avoid them.

### 1. Wrong assumption: "we'll bundle the model in the IPA"

The original `KokoroTestScreen.tsx` used `{ modelPath: { type: 'asset',
path: 'kokoro' }, modelType: 'kokoro' }`. The plan was: download model
locally with `scripts/download-kokoro.sh` into `mobile/assets/kokoro/`,
let EAS Build package the directory, sherpa resolves it via
`NSBundle.mainBundle.resourcePath/kokoro`. **None of this works on
Expo.** Three independent reasons stacked:

- `mobile/assets/kokoro/` was empty (script never ran on the dev
  machine).
- `.easignore` line 55 listed `mobile/assets/kokoro/`, so even if it
  *were* populated EAS wouldn't upload it.
- Expo's asset bundler only ships files referenced via `require()` or
  matched by `assetBundlePatterns` — and it **flattens** matched files.
  Sherpa's resolver expects a real directory at `<NSBundle>/kokoro/`,
  which requires a Xcode "Copy Files" build phase with a folder
  reference. That needs a custom config plugin (50–100 lines using the
  `xcode` package).

**Lesson:** "ship it as an asset" sounds like the simple path but
requires a custom Expo config plugin for any model that's more than one
file. For multi-file model bundles, runtime download into Documents/ is
the path of less resistance even if it sounds heavier upfront.

### 2. The first error message lied to us

The user reported "Phase error unable to resolve module react native0fs."
The actual error was "Unable to resolve module
`@dr.pogodin/react-native-fs`" — a peer dependency
`react-native-sherpa-onnx` declares but doesn't list in `dependencies`,
and Wave's `mobile/package.json` never added it. The scoped-name slash
+ dot rendered as "0fs" in the user's eye. **Fix:**
`npx expo install @dr.pogodin/react-native-fs` + native rebuild.

### 3. Asset-resolver error misread as a configuration problem

After installing the missing peer, sherpa-onnx returned `Asset path not
found: kokoro` from `SherpaOnnx+Assets.mm:resolveAssetPath`. That error
is what surfaces when none of the three resolver fallbacks
(Documents/models/kokoro/, NSBundle/kokoro/, pathForResource:) hit.
Reading the native resolver was the moment we realized the bundled-asset
plan was structurally impossible without a config plugin.

### 4. Pivot to runtime download

Switched to sherpa-onnx's built-in download manager —
`refreshModelsByCategory(Tts)` + `ensureModelByCategory(Tts, id, …)`.
It handles GitHub release lookup, tarball download with resume,
extraction, checksum, and returns a local path you feed back as `{ type:
'file', path }`. Critical detail: **`ensureModelByCategory` only reads
the on-disk registry cache.** On a fresh install that cache is empty and
every id throws "Unknown model id". Must call
`refreshModelsByCategory` first.

### 5. Wrong model id

Hit "Unknown model id: kokoro-en-v0.19". The release uses underscore,
not dot. The `download-kokoro.sh` script had been copy-pasted with the
dot version from documentation somewhere. Running
`gh api repos/k2-fsa/sherpa-onnx/releases/tags/tts-models --jq
'.assets[] | select(.name | test("kokoro"; "i")) | .name'`
listed the real asset names.

### 6. "Played" but no audio came out

The original `KokoroTestScreen.tsx` had a stub: it called
`generateSpeech()` to produce samples, then dropped them on the floor
with a `// saveAudioToFile would go here once the engine is wired`
comment. State machine advanced to "played" without anything happening.
First version of the fix used `saveAudioToFile` to write a WAV +
`useAudioPlayer` from expo-audio. Worked, but the file roundtrip per
sentence adds latency and isn't streaming.

### 7. Switched to streaming via `createStreamingTTS` + native PCM player

Sherpa-onnx ships **two** APIs we initially missed:

- `createStreamingTTS` returns an engine with
  `generateSpeechStream(text, opts, { onChunk, onEnd, onError })` —
  emits PCM samples per sentence as the model finishes that sentence.
- The same engine has `startPcmPlayer(sampleRate, channels)`,
  `writePcmChunk(samples)`, `stopPcmPlayer()` — a native AVAudioEngine
  audio queue. Wiring `onChunk` → `writePcmChunk` gives true
  low-latency playback as audio is generated, no file I/O.

This was the right architecture all along. We just didn't read the
sherpa-onnx source until after building the file-roundtrip version.

### 8. Two bugs in the first streaming version

- **Truncation:** `[AVAudioPlayerNode stop]` discards scheduled but
  unplayed buffers. We called `stopPcmPlayer()` as soon as
  `generateSpeechStream` resolved, which is when **generation** ends, not
  when **playback** ends. Audio was cut off mid-sentence. Fix:
  `setTimeout(stopPcmPlayer, max(0, totalSamples/sr*1000 -
  elapsedSinceFirstChunk) + 200)` — wait for the queue to drain.
- **Static / pitch artifact:** We called `startPcmPlayer` with the value
  from `getSampleRate()` before any chunks arrived. Each `onChunk`
  carries its own `sampleRate`; if those disagreed (which they can)
  AVAudioPCMBuffer interprets the floats at the wrong rate, producing
  pitch-shifted grit. Fix: lazy-start the player on first chunk using
  `c.sampleRate` from the chunk itself, warn on any subsequent chunk
  that disagrees.

### 9. A/B comparison surfaced the int8-vs-fp32 finding

Built `KokoroTestScreen.tsx` into a 4-way comparison harness (chips for
each variant, comparison table for accumulated runs). Empirically EN
v0.19 fp32 had the lowest TTFB *and* the cleanest audio. After the
finding was clear, we pinned the production wiring to fp32 and simplified
the test screen back down to a single-model debug page (the comparison
harness is preserved in git history if we ever need to rerun it).

## Files touched

- `mobile/src/screens/KokoroTestScreen.tsx` — runtime download +
  streaming PCM player, pinned to EN fp32, with stats panel for ongoing
  perf measurement.
- `mobile/src/screens/CombinedVoiceTestScreen.tsx` — same model loading
  swap, plus the missing `Directory.create()` that meant
  `saveAudioToFile` was writing into a nonexistent directory.
- `mobile/package.json` — added `@dr.pogodin/react-native-fs` peer
  dependency.

## Cleanup completed (2026-05-16)

After the wiring shipped, removed the leftovers from the abandoned
bundled-asset plan:

- Deleted `mobile/scripts/download-kokoro.sh`.
- Removed `mobile/assets/kokoro/` from `.easignore` and
  `mobile/.gitignore`.
- Updated `mobile/docs/architecture.md` (Kokoro paragraph and directory
  tree) and `mobile/docs/handoff.md` (route table, bootstrap steps,
  critical gotchas) to reflect the runtime-download path.

## Open follow-ups

- **Bridge marshalling cost.** Each `writePcmChunk` ships ~24k JS
  numbers per second per sentence across the RN bridge as
  `NSArray<NSNumber*>`. Not a problem at current quality but if we ever
  see chunk-boundary glitches under load, the fix is TurboModules +
  ArrayBuffer support.
- **First-call latency.** CoreML EP cold-compiles on the first generate
  call, adding ~500–1500 ms TTFB once per app launch. Mitigation: warm
  the engine with a throwaway 1-word call right after model load.
- **Drain-wait estimate.** The current `audioMs - elapsed + 200ms`
  heuristic is a best-effort; if generation is slow enough that the
  audio queue runs dry mid-playback before the timer fires, we'd stop
  early. Hasn't happened in testing, but a proper fix would tap into
  AVAudioPlayerNode's `scheduleBuffer:completionHandler:` instead of
  passing `nil`.
