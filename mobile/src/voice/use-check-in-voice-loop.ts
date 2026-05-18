// Hands-free check-in voice loop — production port of the proven
// CombinedVoiceTestScreen path (Silero VAD endpoint → Whisper base STT →
// streamCheckInTurn (stock Gemma 4 GPU) → Kokoro TTS), with ZERO screen
// interaction: it auto-starts, the agent asks the 1–10 opener, then runs
// the multi-turn loop until the model emits endConversation OR the
// patient's words signal they're done (deterministic, like production).
//
// Half-duplex (demo-safe, per deploy.md): the mic is muted while the
// agent speaks, so the open speaker can't barge-in on itself. The
// resident models (Gemma, Kokoro) are already warmed by the chunk
// player; VAD + Whisper are ensured here.

import { useCallback, useEffect, useRef, useState } from "react";
import { setAudioModeAsync } from "expo-audio";
import { initWhisper, type WhisperContext } from "whisper.rn";

import { streamCheckInTurn, type CheckInChatTurnPayload } from "@/gemma/checkin";
import { ensureModel } from "@/runtime/model-cache";
import { createSileroVad, VAD_SAMPLE_RATE, type SileroVad } from "@/voice/silero-vad";
import { useVadEndpointer } from "@/voice/use-vad-endpointer";
import { writePcmToWavFile } from "@/voice/pcm-wav";
import { detectReadyToEnd, parseCravingScore } from "@/voice/conversation";
import { speak, ensureKokoro, stopSpeaking } from "@/voice/kokoro";
import { checkInContextFromState } from "@/session/build-context";
import { useSession } from "@/session/session-context";
import type { ConvMessage } from "@/voice/conversation";
import type { CheckIn, ChunkNumber, ObstacleCategory } from "@/types/session";

const OPENING =
  "Welcome back. Let us start with a quick check in. On a scale of one to ten, what is your craving right now?";

export type LoopPhase =
  | "warming"
  | "speaking"
  | "listening"
  | "recording"
  | "transcribing"
  | "thinking"
  | "done"
  | "error";

function cleanWhisper(raw: string): string {
  return raw
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface CheckInVoiceLoop {
  phase: LoopPhase;
  messages: ConvMessage[];
  score: number | null;
  error: string | null;
  /** Manual escape — commits whatever we have and advances. */
  finishNow: () => void;
}

export function useCheckInVoiceLoop(): CheckInVoiceLoop {
  const { state, dispatch } = useSession();
  const [phase, setPhase] = useState<LoopPhase>("warming");
  const [messages, setMessages] = useState<ConvMessage[]>([]);
  const [score, setScore] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const vadRef = useRef<SileroVad | null>(null);
  const whisperRef = useRef<WhisperContext | null>(null);
  const historyRef = useRef<CheckInChatTurnPayload[]>([]);
  const scoreRef = useRef<number | null>(null);
  const obstacleRef = useRef<ObstacleCategory | null>(null);
  const endedRef = useRef(false);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const startedRef = useRef(false);
  const startedAtRef = useRef(Date.now());
  const chunkNo = state.currentChunk;

  const finalize = useCallback(() => {
    if (endedRef.current && phase === "done") return;
    endedRef.current = true;
    void stopSpeaking();
    const now = Date.now();
    const checkIn: CheckIn = {
      chunkNumber: chunkNo as ChunkNumber,
      cravingScore: scoreRef.current ?? state.intake?.intakeIntensity ?? 5,
      turns: historyRef.current.map((t, i) => ({
        index: i + 1,
        role: t.role,
        content: t.content,
        via: t.role === "patient" ? "patient" : "lora",
      })),
      obstacleCategory: obstacleRef.current,
      readyToContinue: chunkNo >= state.totalChunks ? null : true,
      startedAt: startedAtRef.current,
      endedAt: now,
    };
    setPhase("done");
    console.log(
      `[wave][checkin] finalize chunk=${chunkNo} score=${checkIn.cravingScore} turns=${checkIn.turns.length}`,
    );
    dispatch({ type: "checkInCompleted", checkIn });
  }, [chunkNo, dispatch, phase, state.intake, state.totalChunks]);

  // One serialized turn: STT → LLM (streamCheckInTurn) → speak → re-listen.
  const runTurn = useCallback(
    async (pcm: Float32Array) => {
      if (busyRef.current || endedRef.current || !mountedRef.current) return;
      busyRef.current = true;
      endpointerRef.current?.setMuted(true);
      try {
        // ── STT ──
        setPhase("transcribing");
        const ctx = whisperRef.current;
        if (!ctx) throw new Error("Whisper not initialized");
        const wavUri = await writePcmToWavFile(pcm, VAD_SAMPLE_RATE);
        const { promise } = ctx.transcribe(wavUri, { language: "en" });
        const { result } = await promise;
        const patientText = cleanWhisper(result);
        console.log(`[wave][checkin] STT: "${patientText}"`);
        if (!patientText) return; // finally → unmute + listen again

        historyRef.current.push({ role: "patient", content: patientText });
        if (scoreRef.current == null) {
          const sc = parseCravingScore(patientText);
          if (sc != null) {
            scoreRef.current = sc;
            if (mountedRef.current) setScore(sc);
          }
        }

        // Rebuild the transcript view from history (patient turn now in).
        const view: ConvMessage[] = historyRef.current.map((t) => ({
          role: t.role === "patient" ? "user" : "assistant",
          text: t.content,
          tool: null,
        }));
        if (mountedRef.current) setMessages(view);

        // ── LLM (production check-in boundary) ──
        setPhase("thinking");
        const endHolder: {
          sig: { cravingScore: number; obstacleCategory: ObstacleCategory | null } | null;
        } = { sig: null };
        const res = await streamCheckInTurn({
          history: historyRef.current,
          context: checkInContextFromState(state),
          onEndConversation: (s) => {
            endHolder.sig = s;
          },
        });
        const reply = res.text.trim();
        historyRef.current.push({ role: "agent", content: reply });
        if (mountedRef.current) {
          setMessages([
            ...view,
            { role: "assistant", text: reply, tool: null },
          ]);
        }
        if (endHolder.sig) {
          scoreRef.current = endHolder.sig.cravingScore ?? scoreRef.current;
          obstacleRef.current =
            endHolder.sig.obstacleCategory ?? obstacleRef.current;
          if (mountedRef.current && scoreRef.current != null) {
            setScore(scoreRef.current);
          }
        }

        // Deterministic termination: model tool OR patient said done OR
        // demo mode wraps after the first full exchange.
        const ready = detectReadyToEnd(patientText);
        const demoWrap = state.demoMode && historyRef.current.length >= 2;
        const ending = !!endHolder.sig || ready || demoWrap;

        // ── TTS ── (mic stays muted — half-duplex)
        if (reply) {
          setPhase("speaking");
          try {
            await speak(reply);
          } catch (err) {
            console.warn("[wave][checkin] TTS failed:", err);
          }
        }

        if (ending) {
          finalize();
          return;
        }
      } catch (err) {
        const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        console.error("[wave][checkin] turn error:", msg);
        if (mountedRef.current) setError(msg);
      } finally {
        busyRef.current = false;
        if (!endedRef.current && mountedRef.current) {
          endpointerRef.current?.setMuted(false);
          setPhase("listening");
        }
      }
    },
    [finalize, state],
  );

  const endpointer = useVadEndpointer({
    vadRef,
    onSpeechStart: () => {
      if (!busyRef.current && !endedRef.current) setPhase("recording");
    },
    onSpeechEnd: (utterance) => {
      void runTurn(utterance);
    },
    onError: (m) => setError(m),
  });
  const endpointerRef = useRef(endpointer);
  endpointerRef.current = endpointer;

  // Boot: ensure VAD + Whisper + Kokoro, seed + speak the opener, listen.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    mountedRef.current = true;
    startedAtRef.current = Date.now();
    (async () => {
      try {
        // Playback-only first. allowsRecording:true puts iOS in
        // playAndRecord with NO defaultToSpeaker → output goes to the
        // EARPIECE (quiet) — that's why the opener was quiet and the
        // reply (after sherpa's player owned the speaker route) loud.
        // deploy.md: don't enable recording while TTS plays; let
        // sherpa's startPcmPlayer own the session during playback.
        await setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
        setPhase("warming");
        console.log("[wave][checkin] warming VAD/Whisper/Kokoro");
        const vadPath = await ensureModel("silero-vad");
        vadRef.current = await createSileroVad(vadPath);
        const wp = await ensureModel("whisper-base-en");
        whisperRef.current = await initWhisper({ filePath: wp, useGpu: true });
        await ensureKokoro();
        if (!mountedRef.current) return;

        historyRef.current = [{ role: "agent", content: OPENING }];
        setMessages([{ role: "assistant", text: OPENING, tool: null }]);
        setPhase("speaking");
        try {
          await speak(OPENING);
        } catch {
          /* speak failed — still listen so the loop isn't stuck */
        }
        if (!mountedRef.current) return;
        // Opener has finished playing (speak() now drains fully) — NOW
        // enable the mic for the VAD listening window. Output stays on
        // the loud speaker route sherpa established for the opener.
        await setAudioModeAsync({
          playsInSilentMode: true,
          allowsRecording: true,
        }).catch(() => {});
        await endpointerRef.current?.startListening();
        if (mountedRef.current) setPhase("listening");
      } catch (err) {
        const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        console.error("[wave][checkin] warm-up failed:", msg);
        if (mountedRef.current) {
          setError(msg);
          setPhase("error");
        }
      }
    })();

    return () => {
      mountedRef.current = false;
      (async () => {
        try {
          await endpointerRef.current?.stopListening();
        } catch {}
        try {
          await stopSpeaking();
        } catch {}
        try {
          await vadRef.current?.release();
        } catch {}
        try {
          await whisperRef.current?.release();
        } catch {}
      })();
    };
  }, []);

  const finishNow = useCallback(() => {
    finalize();
  }, [finalize]);

  return { phase, messages, score, error, finishNow };
}
