# Voice loop TTS: reply plays halfway, jumps loud, then cuts off before the block finishes

> **Revision 2** — incorporates two impartial observer reviews on issue #26
> (branch boundary, kokoro.ts not a clean drain reference, Option A step
> coupling, native-change cost, real mic-release semantics, multi-turn
> acceptance criteria).

## Target branch (resolve first — per observer review)

**The fix targets `wave/oceanic-reskin`, not `main`.** `src/voice/kokoro.ts`
and `src/voice/use-check-in-voice-loop.ts` exist **only** on
`wave/oceanic-reskin`; on `main`, `app/session/checkin.tsx` is a stub whose
comments describe a *future* port. Therefore:

- The "production check-in path" affected by this bug is **branch-specific to
  `wave/oceanic-reskin`** — not reproducible on `main`.
- `CombinedVoiceTestScreen.tsx`, the native sherpa sources, and `deploy.md`
  references **are** on `main` and were verified there.
- Implementers work on `wave/oceanic-reskin`. Any `kokoro.ts:NN` line refs
  below are that branch's worktree copy.

## Summary

In the multi-turn voice loop (`/tests/combined` →
`CombinedVoiceTestScreen.tsx`, and the `wave/oceanic-reskin` check-in path via
`src/voice/kokoro.ts` + `src/voice/use-check-in-voice-loop.ts`), a spoken agent
reply **plays partway, suddenly jumps loud, then stops before the full text is
spoken.** `KokoroTestScreen.tsx` (single phrase per tap) plays full
multi-sentence blocks **perfectly** — the known-good reference. Root-caused via
3 parallel investigation agents; all converged on the same mechanism.

## Symptom → cause (each independently confirmed)

| Symptom | Root cause |
|---|---|
| **Suddenly loud mid-utterance** | The mic/VAD stream (re)starting re-asserts iOS `AVAudioSession` `PlayAndRecord` / `VoiceChat` / `DefaultToSpeaker` + voice-processing on every stream start (`SherpaOnnx+PcmLiveStream.mm ~88-106`: unconditional `setCategory`+`setActive:YES`+`setVoiceProcessingEnabled:YES`) **while the TTS `AVAudioPlayerNode` is still draining** → mid-playback route/gain change. Distinct from `deploy.md:88-94` (that pitfall is the *quieter/earpiece* expo-audio path; this is the *louder* native VoiceChat path — the JS guard at `CombinedVoiceTestScreen.tsx:360-367` does not cover it). |
| **Stops before the block finishes** | `speak()` resolves on an **underestimated `setTimeout` drain**. `playbackStartedAt` is stamped at *first chunk arrival* (`CombinedVoiceTestScreen.tsx:333-339`; same bug in worktree `kokoro.ts:96`), not when `startPcmPlayer` resolves (~100-300 ms later). `elapsed` over-counted → `drainMs = max(0, audioMs - elapsed) + 500/600` too short → the loop advances and the next turn / listening restart contends/tears down the still-buffered player (`stopTtsPcmPlayer` flush/stop/reset `SherpaOnnx+TTS.mm ~1546-1555`). |
| **Speaks halfway / non-deterministic** | Non-first `writePcmChunk` calls are **fire-and-forget, unserialized** (`CombinedVoiceTestScreen.tsx:379-387`). The worktree `kokoro.ts` write-serialization (`chain = chain.then(...)`) is the **only** part of kokoro.ts worth copying — its drain logic carries the same early-resolve bug and must NOT be copied. |

## Decisive divergence vs. the known-good path

- **`KokoroTestScreen` (works):** playback-only session (`{ playsInSilentMode: true }`, no `allowsRecording`, no mic), **per-phrase** player lifecycle.
- **Voice loop (broken):** recording-enabled session (`{ allowsRecording: true }`) + live VAD/mic + player **resident across turns** + mic re-asserting the session mid-playback.

## Constraints / tensions (must be resolved before/within implementation)

1. **turn-2-no-voice:** `deploy.md` + `CombinedVoiceTestScreen` (~:346-349):
   sherpa's player goes silent after stop→restart, which is *why* the loop
   never stops the player between turns. Any multi-turn fix must avoid this.
2. **Native sherpa patch forces `PlayAndRecord`/`VoiceChat` so the mic
   survives playback** — directly in tension with Option A's session-isolation
   goal. This needs an **explicit half-duplex vs AEC/full-duplex decision**,
   not a JS-only change.
3. **Endpointer teardown risk:** `use-vad-endpointer.ts` `stop` only calls
   `stream.stop()` and never restores the session; native `setActive:NO` runs
   only on error paths. Fully releasing the endpointer during `speaking` may
   leave the AVAudioSession in a state that re-triggers turn-2-no-voice while
   the resident player continues — **must be verified on device**.

## Proposed plan — Option A (recommended), resequenced per review

Keep the player resident across turns (avoids turn-2-no-voice). Steps are
**ordered by dependency** (observer: step 1 depends on step 2):

**Step 1 (prerequisite) — true playback-complete signal.**
`speak()` must resolve on real playback end, not a `setTimeout` estimate.
- **Native (authoritative):** pass a `completionHandler` to `scheduleBuffer`
  (`SherpaOnnx+TTS.mm:1523`, currently `nil`) tracking outstanding buffers;
  expose to JS; `speak()` awaits that.
  - **Cost (was understated):** this edits vendored `react-native-sherpa-onnx`
    → a **patch-package patch (or vendor fork) + a dev-client rebuild** +
    ongoing patch maintenance (deploy.md already flags sherpa as
    patch-package'd). This is a native workstream, not a JS edit.
- **Interim JS-only mitigation (until native lands):** stamp
  `playbackStartedAt` inside the `startPcmPlayer().then()` callback (not at
  first chunk) and widen the margin. Explicitly temporary.

**Step 2 — isolate the session during playback (depends on Step 1).**
Once true drain is known: **release the mic with real `stopListening()` /
native stream stop** (NOT just `setMuted(true)` — the loop currently only
mutes, the native mic stream stays up) for the entire `speaking` phase, and
re-acquire only after Step 1 signals playback complete. Before implementing,
**verify on device** the endpointer teardown does not strand the
AVAudioSession and re-trigger turn-2-no-voice (constraint 3); decide the
half-duplex vs AEC posture (constraint 2) and document it.

**Step 3 — serialize PCM writes.**
Reproduce the `chain = chain.then(() => writePcmChunk(...))` pattern
explicitly in `CombinedVoiceTestScreen` (the worktree `kokoro.ts` already does
this — copy the *pattern*, not the file).

### Alternatives
- **Option B — per-phrase player lifecycle (match KokoroTestScreen).** Cleanest
  isolation; high risk of regressing turn-2-no-voice in a multi-turn loop;
  requires the multi-turn device matrix below to clear.
- **Option C — drain-timing + write-serialization only.** Smallest; fixes
  early-cut + "halfway"; loudness-jump remains until Step 2.

## Acceptance criteria (device-observable, multi-turn — per review)

turn-2-no-voice only manifests **across** turns, so a single-turn check can
pass a still-broken build. Required, over **≥3 consecutive turns**:
- Opener and every reply audible **from first to last word** (no truncation).
- **No loudness/level jump** at mic (re)start during any utterance.
- Mic resumes **only after** playback completion (Step 1 signal), never mid-audio.
- **No turn-2+ silence** (resident-player regression check).
- Final-turn reply fully spoken **before** navigation/finalize.

**Manual device matrix:** {half-duplex build, AEC build} × {speaker, earbuds} ×
{short reply, long multi-sentence reply} × {turn 1, turn 2, turn 3} ×
{final/navigation handoff}.

## Test gap (per review)

Existing off-device tests cover conversation flow + sentence buffering only.
**Not covered:** TTS drain resolution, VAD/endpointer lifecycle, native
playback-completion signaling, serialized PCM writes. Add unit coverage for the
drain/serialization logic where it can be made pure; the session/native pieces
remain device-matrix-verified.

## Key files

- `mobile/src/screens/CombinedVoiceTestScreen.tsx` (`speak()` :305-440, drain :417-422, writes :379-387, audio mode :259-262, session-guard comment :360-367, never-stop comment ~:346-349)
- `mobile/src/screens/KokoroTestScreen.tsx` (known-good reference, :245-307)
- `mobile/src/voice/kokoro.ts` *(wave/oceanic-reskin only)* — copy **write serialization only** (`:79-135`); its drain estimate has the same bug
- `mobile/src/voice/use-check-in-voice-loop.ts` *(wave/oceanic-reskin only)*; `mobile/src/voice/use-vad-endpointer.ts` (teardown only `stream.stop()`, no session restore)
- native: `SherpaOnnx+PcmLiveStream.mm ~88-106`, `SherpaOnnx+TTS.mm:1523` / `~1546-1555`
- `mobile/deploy.md:88-94` (the *distinct* expo-audio earpiece pitfall)

**Recommended: Option A**, steps in the resequenced order above, on
`wave/oceanic-reskin`, gated by the multi-turn device matrix.
