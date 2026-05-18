// Full hands-free voice loop (issue #21).
//
//   Silero VAD endpointing → Whisper base STT → Gemma 4 (stock, GPU
//   LiteRT) → Kokoro streaming TTS → playback, with stop-playback barge-in.
//
// Architecture decisions (locked in #21):
//   - ALL-RESIDENT: VAD + Whisper base + stock-Gemma-GPU + Kokoro stay
//     loaded for the whole session. No per-turn load/unload.
//   - Barge-in = STOP PLAYBACK ONLY: speech during TTS cancels Kokoro and
//     re-listens; the (already-finished) LLM turn is never re-run, no
//     2.5 GB reload.
//   - Stock Gemma on GPU is the GPU-validated bundle; the loop talks to it
//     through the (modelId,backend,systemPrompt)-keyed preloadLiteRT —
//     NOT preloadWaveLiteRT (which is litert-wave/CPU and would no-op the
//     backend, per review #1).
//
// Concurrency (review #3): one resident LLM can't take a new turn until the
// prior sendMessage resolves. `llmBusyRef` serializes turns; a barge/utter
// that lands mid-turn is stashed in `pendingPcmRef` (latest wins) and run
// when the current turn finishes. `epochRef` invalidates a stale reply so a
// barged-over turn is never spoken.
//
// State machine:
//   idle → loading → listening
//   listening →(speechEnd) transcribing → generating → speaking → listening
//   speaking →(speechStart, past grace) listening   [barge-in]
//
// Mic policy: the endpointer is muted during transcribing/generating (the
// loop must not recurse on itself) and live during listening/speaking
// (speaking stays live for barge-in). Self-trigger from the device speaker
// during TTS is a known limitation — a short grace window after playback
// start absorbs the worst of it; earbuds for the demo. Tracked in #21.

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { setAudioModeAsync } from "expo-audio";
import { initWhisper, type WhisperContext } from "whisper.rn";

import {
  preloadLiteRT,
  unloadLiteRT,
  type LiteRTLoadConfig,
} from "@/runtime/litert-generators";
import { ensureModel, MODELS } from "@/runtime/model-cache";
import {
  createSileroVad,
  VAD_SAMPLE_RATE,
  type SileroVad,
} from "@/voice/silero-vad";
import { useVadEndpointer } from "@/voice/use-vad-endpointer";
import { writePcmToWavFile } from "@/voice/pcm-wav";
import { WAVE_SYSTEM_PROMPT } from "@/prompts/wave-system";
import {
  ConversationController,
  detectReadyToEnd,
  parseCravingScore,
  type ConvMessage,
} from "@/voice/conversation";
import type { LiteRTLMInstance } from "react-native-litert-lm";

// ── Stock-Gemma-GPU config = the Wave#15-verified envelope (matches
// LiteRTStockScreen): eng2048 / out512 / gpu, deterministic decode.
const TOOL_OBSTACLES =
  "none, cannot_visualize, mind_wandering, urge_overwhelming, breath_tight, breath_anxiety, gave_in, guilt_failure, physical_discomfort, sleepiness";

// Canonical WAVE persona (now output-agnostic) + the mobile JSON
// output-contract. Single-shot per turn; the JSON is parsed by
// conversation.ts extractToolCall — reply is spoken, endConversation is
// the machine signal. Patient never hears the JSON.
const CI_SYSTEM = `${WAVE_SYSTEM_PROMPT}

This is a hands-free post-chunk VOICE check-in: the "reply" text is spoken aloud by text-to-speech, so write exactly the way people talk — short, warm, plain, contractions, numbers as words.

ENDING — read every turn, most important rule:
- If the patient's LATEST message clearly signals they are ready to continue ("I'm ready", "let's keep going", "yeah, go on"), you MUST end now. Set "endConversation" to {cravingScore, obstacleCategory}. "reply" is a brief warm hand-off that closes the check-in — the app moves on to the next part right after, so NO question, NO new topic, NO "tell me more" (e.g. "Thanks for letting me know. We will move on now.").
- Otherwise "endConversation" MUST be null and "reply" ends with exactly one question.

obstacleCategory is one of: ${TOOL_OBSTACLES}. Use "none" if no clear obstacle.

Respond with ONLY a single JSON object, nothing else, exactly:
{"reply": "<spoken prose, 1-3 short sentences, no markdown/lists/emoji/quotes>", "endConversation": null | {"cravingScore": <integer 1-10>, "obstacleCategory": "<one category>"}}
Output nothing outside the JSON object — no preamble, no code fences, no extra keys.`;

// The session starts with WAVE speaking — a fixed, reliable opener that
// asks the craving score (too important to leave to the model). Numbers
// as words, no punctuation TTS chokes on.
const OPENING =
  "Welcome back. Let us start with a quick check in. On a scale of one to ten, what is your craving right now?";

// Single-shot mobile path (#25): NO load-time system prompt — every
// turn we resetConversation() and send ONE message = CI_SYSTEM (WAVE +
// JSON contract) + flattened transcript + "WAVE:". eng4096 so the
// canonical prompt + contract + growing transcript fit (proven on the
// litert-stock big-prompt test).
const STOCK_GPU_CONFIG: LiteRTLoadConfig = {
  modelId: "litert-stock-gemma4",
  backend: "gpu",
  engineMaxTokens: 4096,
  outputMaxTokens: 512,
  // systemPrompt intentionally omitted — single-shot puts it in the msg.
  temperature: 0,
  topK: 1,
};

const KOKORO_MODEL_ID = "kokoro-en-v0_19";

// Ignore VAD onset for this long after playback starts so the device
// speaker doesn't barge-in on itself the instant Kokoro begins.
const BARGE_GRACE_MS = 600;

// Best-effort memory guard. There's no first-party device-free-RAM API
// without a new native module, so the "gate" is: surface the projected
// footprint before load, then read the LLM's own getMemoryUsage() after
// load and warn (non-fatal) if resident blows past a safe ceiling.
const KOKORO_DISK_BYTES = 304 * 1024 * 1024;
const PROJECTED_DISK_BYTES =
  MODELS["litert-stock-gemma4"].expectedBytes +
  MODELS["whisper-base-en"].expectedBytes +
  MODELS["silero-vad"].expectedBytes +
  KOKORO_DISK_BYTES;
const SAFE_RESIDENT_CEILING_BYTES = 6 * 1024 * 1024 * 1024;

type Phase =
  | "idle"
  | "loading"
  | "listening"
  | "transcribing"
  | "generating"
  | "speaking"
  | "error";

interface SubsystemState {
  vad: "missing" | "loading" | "ready" | "error";
  litert: "missing" | "loading" | "ready" | "error";
  whisper: "missing" | "loading" | "ready" | "error";
  kokoro: "missing" | "loading" | "ready" | "error";
}

type StreamingTtsEngine = {
  generateSpeechStream: (
    text: string,
    opts: unknown,
    handlers: {
      onChunk?: (c: {
        samples: number[];
        sampleRate: number;
        isFinal: boolean;
      }) => void;
      onEnd?: (e: { cancelled: boolean }) => void;
      onError?: (e: { message: string }) => void;
    },
  ) => Promise<{ cancel: () => Promise<void> }>;
  cancelSpeechStream: () => Promise<void>;
  startPcmPlayer: (sampleRate: number, channels: number) => Promise<void>;
  writePcmChunk: (samples: number[]) => Promise<void>;
  stopPcmPlayer: () => Promise<void>;
  destroy: () => Promise<void>;
};

function fmtMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms.toFixed(0)}ms`;
}

function fmtBytes(b: number): string {
  if (!b || !Number.isFinite(b)) return "—";
  const u = ["B", "KB", "MB", "GB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
  return `${(b / Math.pow(1024, i)).toFixed(i > 1 ? 2 : 0)} ${u[i]}`;
}

// whisper.cpp emits non-speech markers like [BLANK_AUDIO] / (wind blowing).
// Strip bracketed/parenthesized tokens; empty after that = no speech.
function cleanWhisper(raw: string): string {
  return raw
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Tool-call parsing now lives in the pure, unit-tested conversation
// module (extractToolCall there) — no private copy here.

export default function CombinedVoiceTestScreen() {
  const [phase, setPhaseState] = useState<Phase>("idle");
  const phaseRef = useRef<Phase>("idle");
  const setPhase = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhaseState(p);
  }, []);

  const [subsystems, setSubsystems] = useState<SubsystemState>({
    vad: "missing",
    litert: "missing",
    whisper: "missing",
    kokoro: "missing",
  });
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConvMessage[]>([]);
  const [checkInEnded, setCheckInEnded] = useState<string | null>(null);
  const [residentBytes, setResidentBytes] = useState(0);
  const [stats, setStats] = useState({ sttMs: 0, llmMs: 0, tps: 0 });
  // Per-turn diagnostics (issue #25 B): isolate "no LLM text" vs Kokoro
  // engine-reuse on turn 2+. Shown on-screen and logged to Metro.
  const [diag, setDiag] = useState<{
    turn: number;
    rawLen: number;
    replyLen: number;
    ttsChunks: number;
    ttsEnded: boolean;
    note: string;
  } | null>(null);
  const [kokoroDl, setKokoroDl] = useState<{
    percent: number;
    phase: "downloading" | "extracting" | null;
  }>({ percent: 0, phase: null });

  const vadRef = useRef<SileroVad | null>(null);
  const llmRef = useRef<LiteRTLMInstance | null>(null);
  const ttsRef = useRef<StreamingTtsEngine | null>(null);
  const whisperRef = useRef<WhisperContext | null>(null);

  const llmBusyRef = useRef(false);
  const pendingPcmRef = useRef<Float32Array | null>(null);
  const epochRef = useRef(0);
  const convStartedRef = useRef(false);
  const pcmPlayerActiveRef = useRef(false);
  const speakingStartedAtRef = useRef(0);
  const mountedRef = useRef(true);
  const convRef = useRef(new ConversationController());
  const turnCountRef = useRef(0);
  // Deterministic check-in termination (the model won't reliably set
  // endConversation — see logs; the app owns this, like production).
  const cravingScoreRef = useRef<number | null>(null);
  const endedRef = useRef(false);

  // Barge-in / duplex mode. Default = half-duplex (false): mic muted
  // during TTS, no barge-in, bulletproof on an open speaker — the
  // device-tested, demo-safe path that this PR ships. Full-duplex (true)
  // keeps the mic live so you can talk over the reply, but needs the
  // native AEC build or headphones (else the speaker self-triggers);
  // it's opt-in via the toggle and still unverified on device.
  const [bargeIn, setBargeInState] = useState(false);
  const bargeInRef = useRef(false);
  const setBargeIn = useCallback((v: boolean) => {
    bargeInRef.current = v;
    setBargeInState(v);
  }, []);

  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      allowsRecording: true,
    }).catch(() => {});
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Live resident-MB readout (plan: memory-budget gate + visibility).
  useEffect(() => {
    if (subsystems.litert !== "ready") return;
    const tick = () => {
      try {
        const mem = llmRef.current?.getMemoryUsage();
        if (mem && mountedRef.current) setResidentBytes(mem.residentBytes);
      } catch {
        /* engine may be mid-call */
      }
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => clearInterval(id);
  }, [subsystems.litert]);

  const cancelTtsAndPlayer = useCallback(async () => {
    const eng = ttsRef.current;
    if (!eng) return;
    try {
      await eng.cancelSpeechStream();
    } catch {
      /* best-effort */
    }
    if (pcmPlayerActiveRef.current) {
      try {
        await eng.stopPcmPlayer();
      } catch {
        /* best-effort */
      }
      pcmPlayerActiveRef.current = false;
    }
  }, []);

  // Parse-then-speak (review #2): the reply is fully formed before we
  // synthesize — no token-streamed TTS. Returns when playback is done or
  // the turn was superseded by a barge-in.
  const speak = useCallback(
    (text: string, myEpoch: number): Promise<void> => {
      const eng = ttsRef.current;
      if (!eng || !text) return Promise.resolve();
      setPhase("speaking");
      let totalSamples = 0;
      let chunkCount = 0;
      let firstChunkAt = 0;
      // Set only once startPcmPlayer resolves — true playback start.
      // Measuring drain from chunk-arrival instead truncates the tail
      // (startPcmPlayer is async, ~100-300 ms behind the first chunk).
      let playbackStartedAt = 0;
      let playerSr = 24_000;
      const turnNo = turnCountRef.current;

      return new Promise<void>((resolve) => {
        let settled = false;
        const done = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        eng
          .generateSpeechStream(text, undefined, {
            onChunk: (c) => {
              // A barge-in (or next turn) bumped the epoch — stop feeding
              // the player; cancelTtsAndPlayer() already tore it down.
              if (epochRef.current !== myEpoch) return;
              if (firstChunkAt === 0) {
                // First chunk of THIS turn — mark when this turn's audio
                // begins entering the (continuous) player.
                firstChunkAt = Date.now();
                speakingStartedAtRef.current = firstChunkAt;
                playbackStartedAt = firstChunkAt;
                playerSr = c.sampleRate;
              }
              if (!pcmPlayerActiveRef.current) {
                // Start the PCM player ONCE for the whole session and keep
                // it alive across turns. sherpa's player goes silent after
                // a stop→restart cycle (turn-2-no-voice: startPcmPlayer
                // reports OK but outputs nothing); the sandbox works
                // precisely because it never stops between calls. So we
                // never stopPcmPlayer between turns — only on barge-in or
                // teardown. Guard with the ref so only the first chunk
                // ever triggers the single start.
                pcmPlayerActiveRef.current = true;
                console.log(
                  `[voiceloop] tts turn ${turnNo} startPcmPlayer(sr=${c.sampleRate}) [once]…`,
                );
                eng
                  .startPcmPlayer(c.sampleRate, 1)
                  .then(() => {
                    console.log(
                      `[voiceloop] tts turn ${turnNo} startPcmPlayer OK`,
                    );
                    // DO NOT re-assert the audio session here. expo-audio's
                    // setAudioModeAsync({allowsRecording:true}) maps to
                    // playAndRecord WITHOUT defaultToSpeaker → iOS routes
                    // output to the EARPIECE, making TTS inaudible (root
                    // cause of "no audio", confirmed: Apple AVAudioSession
                    // docs + expo-audio AudioModule.swift has no speaker
                    // flag). sherpa's startPcmPlayer already configures the
                    // session for loud-speaker output; leave it alone.
                    return eng.writePcmChunk(c.samples);
                  })
                  .catch((e) => {
                    pcmPlayerActiveRef.current = false; // allow a retry
                    console.log(
                      `[voiceloop] tts turn ${turnNo} startPcmPlayer/write ERR: ${
                        e instanceof Error ? e.message : String(e)
                      }`,
                    );
                  });
              } else {
                eng
                  .writePcmChunk(c.samples)
                  .catch((e) =>
                    console.log(
                      `[voiceloop] tts turn ${turnNo} writePcmChunk ERR: ${
                        e instanceof Error ? e.message : String(e)
                      }`,
                    ),
                  );
              }
              chunkCount += 1;
              totalSamples += c.samples.length;
            },
            onEnd: () => {
              // Diagnostic (issue #25 B): 0 chunks here on turn 2+ ⇒ the
              // Kokoro streaming engine isn't producing on reuse (the
              // "2nd turn no voice" suspect), independent of the LLM.
              console.log(
                `[voiceloop] tts turn ${turnNo} chunks=${chunkCount} samples=${totalSamples} ended=true`,
              );
              setDiag((d) =>
                d
                  ? {
                      ...d,
                      ttsChunks: chunkCount,
                      ttsEnded: true,
                      note:
                        chunkCount === 0
                          ? "TTS produced 0 chunks (Kokoro engine reuse?)"
                          : d.note,
                    }
                  : d,
              );
              // Resolve speak() only after THIS turn's audio has played
              // out, so the loop doesn't start listening over the reply —
              // but do NOT stop the player (it stays alive across turns;
              // stopping then restarting silences sherpa). Measured from
              // this turn's first chunk + margin for buffer scheduling.
              const audioMs = (totalSamples / (playerSr || 24_000)) * 1000;
              const elapsed = playbackStartedAt
                ? Date.now() - playbackStartedAt
                : 0;
              const drainMs = Math.max(0, audioMs - elapsed) + 500;
              setTimeout(done, drainMs);
            },
            onError: (e) => {
              console.log(
                `[voiceloop] tts turn ${turnNo} ERROR chunks=${chunkCount} msg=${e?.message ?? ""}`,
              );
              setDiag((d) =>
                d
                  ? { ...d, ttsChunks: chunkCount, note: `TTS error: ${e?.message ?? "?"}` }
                  : d,
              );
              done();
            },
          })
          .catch(() => done());
      });
    },
    [setPhase],
  );

  // One serialized turn: STT → LLM → (speak). Concurrency-guarded.
  const runTurn = useCallback(
    async (pcm: Float32Array) => {
      if (llmBusyRef.current) {
        pendingPcmRef.current = pcm; // latest wins
        return;
      }
      llmBusyRef.current = true;
      const myEpoch = ++epochRef.current;
      endpointerRef.current?.setMuted(true);
      try {
        // ── STT ──────────────────────────────────────────────────────
        setPhase("transcribing");
        const ctx = whisperRef.current;
        if (!ctx) throw new Error("Whisper not initialized");
        const wavUri = await writePcmToWavFile(pcm, VAD_SAMPLE_RATE);
        const sttT0 = Date.now();
        const { promise } = ctx.transcribe(wavUri, { language: "en" });
        const { result } = await promise;
        const text = cleanWhisper(result);
        setStats((s) => ({ ...s, sttMs: Date.now() - sttT0 }));
        if (!text) {
          setDiag({
            turn: turnCountRef.current,
            rawLen: 0,
            replyLen: 0,
            ttsChunks: 0,
            ttsEnded: false,
            note: "empty transcript — turn skipped",
          });
          return; // finally → unmute + drain pending
        }

        // ── LLM ──────────────────────────────────────────────────────
        setPhase("generating");
        const llm = llmRef.current;
        if (!llm) throw new Error("LiteRT not initialized");
        if (!convStartedRef.current) {
          convRef.current.reset();
          convStartedRef.current = true;
        }
        const turnNo = ++turnCountRef.current;
        const llmT0 = Date.now();
        let rawLen = 0;
        let rawHead = "";
        // Single-shot per turn (the proven mobile path): resetConversation
        // + ONE message = CI_SYSTEM (WAVE persona + JSON output-contract)
        // + the flattened transcript-so-far + "WAVE:". The controller
        // owns history/UI; extractToolCall reads reply + endConversation
        // from the JSON (not raw text).
        const turn = await convRef.current.runTurn(
          text,
          async () => {
            const lines = convRef.current.messages
              .filter((m) => !(m.role === "assistant" && m.pending))
              .map(
                (m) =>
                  `${m.role === "user" ? "Patient" : "WAVE"}: ${m.text}`,
              )
              .join("\n");
            const combined = `${CI_SYSTEM}\n\n${lines}\n\nWAVE:`;
            llm.resetConversation();
            console.log(
              `[citrace] loop turn ${turnNo} promptLen=${combined.length}\n` +
                `===== PROMPT SENT TO LLM =====\n${combined}\n` +
                `===== END PROMPT =====`,
            );
            const raw = await llm.sendMessage(combined);
            console.log(
              `[citrace] loop turn ${turnNo} rawLen=${raw.length}\n` +
                `===== RAW LLM OUTPUT =====\n${raw}\n===== END RAW =====`,
            );
            rawLen = raw.length;
            rawHead = raw.slice(0, 120);
            return raw;
          },
          { onChange: (m) => setMessages(m as ConvMessage[]) },
        );
        const reply = turn?.reply ?? "";
        const modelTool = turn?.tool ?? null;
        // Capture the first craving score the patient stated (turn 1).
        if (cravingScoreRef.current == null) {
          const sc = parseCravingScore(text);
          if (sc != null) cravingScoreRef.current = sc;
        }
        // Deterministic termination: the model won't reliably set
        // endConversation, so the app decides — if the patient's words
        // signal they're ready/done, end the check-in ourselves. The
        // model's JSON tool is still honored if it ever fires.
        const ready = detectReadyToEnd(text);
        const tool =
          modelTool ??
          (ready
            ? `endConversation{cravingScore:${
                cravingScoreRef.current ?? "?"
              },obstacleCategory:none}`
            : null);
        if (tool) {
          endedRef.current = true;
          setCheckInEnded(tool);
        }
        console.log(
          `[voiceloop] turn ${turnNo} llm rawLen=${rawLen} replyLen=${reply.length} tool=${
            modelTool ? "json" : ready ? "deterministic" : "no"
          } score=${cravingScoreRef.current ?? "?"} raw="${rawHead}"`,
        );
        let tps = 0;
        try {
          tps = llm.getStats().tokensPerSecond;
        } catch {
          /* engine may be mid-call */
        }
        setStats((s) => ({ ...s, llmMs: Date.now() - llmT0, tps }));
        setDiag({
          turn: turnNo,
          rawLen,
          replyLen: reply.length,
          ttsChunks: 0,
          ttsEnded: false,
          note:
            rawLen === 0
              ? "LLM returned empty"
              : reply.length === 0
                ? "LLM output was only a tool call"
                : "ok",
        });

        // Barged over while generating? Don't speak the stale reply.
        if (epochRef.current !== myEpoch) return;
        if (!reply) return; // nothing to speak; diag already explains why

        // ── TTS ──────────────────────────────────────────────────────
        // Full-duplex: unmute so VAD can barge-in over playback.
        // Half-duplex: keep the mic muted through TTS (speaker-safe) —
        // it's re-enabled in finally once the reply finishes.
        if (bargeInRef.current) endpointerRef.current?.setMuted(false);
        await speak(reply, myEpoch);
        // Check-in ended: speak the hand-off, then stop the loop (the
        // app would advance to the next section here).
        if (endedRef.current) {
          await endpointerRef.current?.stopListening();
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setPhase("error");
      } finally {
        llmBusyRef.current = false;
        if (endedRef.current && phaseRef.current !== "error") {
          setPhase("idle");
        } else {
          endpointerRef.current?.setMuted(false);
          if (phaseRef.current !== "error") setPhase("listening");
          const pend = pendingPcmRef.current;
          if (pend) {
            pendingPcmRef.current = null;
            void runTurn(pend);
          }
        }
      }
    },
    [setPhase, speak],
  );

  const onSpeechStart = useCallback(() => {
    if (!bargeInRef.current) return; // half-duplex: no acoustic barge-in
    if (phaseRef.current !== "speaking") return;
    if (Date.now() - speakingStartedAtRef.current < BARGE_GRACE_MS) return;
    // Barge-in: invalidate the current spoken turn, kill audio, re-listen.
    // The utterance that triggered this is already being captured by the
    // endpointer; its speechEnd will drive the next turn.
    epochRef.current += 1;
    void cancelTtsAndPlayer();
    setPhase("listening");
  }, [cancelTtsAndPlayer, setPhase]);

  const onSpeechEnd = useCallback(
    (utterance: Float32Array) => {
      void runTurn(utterance);
    },
    [runTurn],
  );

  const endpointer = useVadEndpointer({
    vadRef,
    onSpeechStart,
    onSpeechEnd,
    onError: (msg) => setError(msg),
  });
  // runTurn/onSpeechStart need setMuted without depending on the hook
  // object identity in their useCallback deps.
  const endpointerRef = useRef(endpointer);
  endpointerRef.current = endpointer;

  const initAll = useCallback(async () => {
    setError(null);
    setPhase("loading");

    // VAD
    setSubsystems((s) => ({ ...s, vad: "loading" }));
    try {
      const p = await ensureModel("silero-vad");
      vadRef.current = await createSileroVad(p);
      setSubsystems((s) => ({ ...s, vad: "ready" }));
    } catch (e) {
      setSubsystems((s) => ({ ...s, vad: "error" }));
      setError(`VAD: ${e instanceof Error ? e.message : String(e)}`);
      setPhase("error");
      return;
    }

    // Whisper base
    setSubsystems((s) => ({ ...s, whisper: "loading" }));
    try {
      const wp = await ensureModel("whisper-base-en");
      whisperRef.current = await initWhisper({ filePath: wp, useGpu: true });
      setSubsystems((s) => ({ ...s, whisper: "ready" }));
    } catch (e) {
      setSubsystems((s) => ({ ...s, whisper: "error" }));
      setError(`Whisper: ${e instanceof Error ? e.message : String(e)}`);
      setPhase("error");
      return;
    }

    // Stock Gemma 4 on GPU — via the keyed preload (NOT preloadWaveLiteRT).
    setSubsystems((s) => ({ ...s, litert: "loading" }));
    try {
      llmRef.current = await preloadLiteRT(STOCK_GPU_CONFIG);
      setSubsystems((s) => ({ ...s, litert: "ready" }));
    } catch (e) {
      setSubsystems((s) => ({ ...s, litert: "error" }));
      setError(`LiteRT: ${e instanceof Error ? e.message : String(e)}`);
      setPhase("error");
      return;
    }

    // Kokoro streaming TTS (sherpa-managed download).
    setSubsystems((s) => ({ ...s, kokoro: "loading" }));
    try {
      // Dynamic-import interop: depending on Metro's CJS/ESM wrapping the
      // real exports can land under `.default`. Normalize by probing for
      // the function we actually need, then fall back to `.default`.
      const ttsMod: any = await import("react-native-sherpa-onnx/tts");
      const dlMod: any = await import("react-native-sherpa-onnx/download");
      const sherpaTts: any = ttsMod?.createStreamingTTS
        ? ttsMod
        : (ttsMod?.default ?? ttsMod);
      const sherpaDl: any = dlMod?.ensureModelByCategory
        ? dlMod
        : (dlMod?.default ?? dlMod);
      // ModelCategory.Tts is just the string "tts" at runtime — use it
      // directly so a missing enum object can't crash the loader.
      const TTS_CAT: string = sherpaDl?.ModelCategory?.Tts ?? "tts";
      await sherpaDl.refreshModelsByCategory(TTS_CAT);
      const result = await sherpaDl.ensureModelByCategory(
        TTS_CAT,
        KOKORO_MODEL_ID,
        {
          onProgress: (pr: {
            percent: number;
            phase?: "downloading" | "extracting";
          }) =>
            setKokoroDl({
              percent: pr.percent,
              phase: pr.phase ?? "downloading",
            }),
        },
      );
      setKokoroDl({ percent: 100, phase: null });
      ttsRef.current = (await sherpaTts.createStreamingTTS({
        modelPath: { type: "file", path: result.localPath },
        modelType: "kokoro",
        providers: ["CoreMLExecutionProvider"],
      })) as StreamingTtsEngine;
      setSubsystems((s) => ({ ...s, kokoro: "ready" }));
    } catch (e) {
      setSubsystems((s) => ({ ...s, kokoro: "error" }));
      setError(`Kokoro: ${e instanceof Error ? e.message : String(e)}`);
      setPhase("error");
      return;
    }

    // All resident. Agent speaks FIRST: seed the opening turn (asks the
    // craving score), speak it, then start listening for the patient.
    try {
      convRef.current.reset();
      convStartedRef.current = true; // controller already seeded below
      turnCountRef.current = 0;
      cravingScoreRef.current = null;
      endedRef.current = false;
      setCheckInEnded(null);
      convRef.current.seedAssistant(OPENING);
      setMessages(convRef.current.snapshot());
      await speak(OPENING, ++epochRef.current);
      await endpointerRef.current?.startListening();
      setPhase("listening");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }, [setPhase, speak]);

  // Deterministic teardown (plan mgmt #3): player → stream → vad →
  // whisper → kokoro → llm.
  useEffect(() => {
    return () => {
      (async () => {
        try {
          await endpointerRef.current?.stopListening();
        } catch {}
        try {
          if (pcmPlayerActiveRef.current)
            await ttsRef.current?.stopPcmPlayer();
        } catch {}
        try {
          await vadRef.current?.release();
        } catch {}
        try {
          await whisperRef.current?.release();
        } catch {}
        try {
          await ttsRef.current?.destroy();
        } catch {}
        try {
          await unloadLiteRT(STOCK_GPU_CONFIG);
        } catch {}
      })();
    };
  }, []);

  const allReady =
    subsystems.vad === "ready" &&
    subsystems.litert === "ready" &&
    subsystems.whisper === "ready" &&
    subsystems.kokoro === "ready";
  const isLoading = phase === "loading";
  const isBusy =
    phase === "transcribing" ||
    phase === "generating" ||
    phase === "speaking";
  const overBudget =
    residentBytes > 0 && residentBytes > SAFE_RESIDENT_CEILING_BYTES;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
    >
      <Text style={styles.sub} selectable>
        Hands-free loop: Silero VAD endpoints speech → Whisper base → stock
        Gemma 4 on GPU → Kokoro → playback. Talk over the reply to barge in.
      </Text>

      <SubsystemRow label="Silero VAD" status={subsystems.vad} />
      <SubsystemRow label="Whisper base" status={subsystems.whisper} />
      <SubsystemRow label="Gemma 4 (stock, GPU)" status={subsystems.litert} />
      <SubsystemRow
        label="Kokoro"
        status={subsystems.kokoro}
        detail={
          kokoroDl.phase
            ? `${kokoroDl.phase} ${kokoroDl.percent.toFixed(0)}%`
            : undefined
        }
      />

      <View style={styles.statusRow}>
        <Text style={styles.statusLabel}>Phase:</Text>
        <Text style={[styles.statusValue, phaseStyle(phase)]}>{phase}</Text>
        {(isLoading || isBusy) && (
          <ActivityIndicator size="small" style={{ marginLeft: 8 }} />
        )}
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelHead}>Memory budget</Text>
        <Text selectable style={styles.kv}>
          Projected on-disk: {fmtBytes(PROJECTED_DISK_BYTES)} · ceiling{" "}
          {fmtBytes(SAFE_RESIDENT_CEILING_BYTES)}
        </Text>
        <Text
          selectable
          style={[styles.kv, overBudget && { color: "#F87171" }]}
        >
          LLM resident: {fmtBytes(residentBytes)}
          {overBudget ? "  ⚠ over ceiling" : ""}
        </Text>
      </View>

      {!allReady && (
        <Pressable
          style={[styles.button, isLoading && styles.buttonDisabled]}
          disabled={isLoading}
          onPress={initAll}
        >
          <Text style={styles.buttonText}>
            {isLoading
              ? "Loading all four models…"
              : "Initialize & go hands-free"}
          </Text>
        </Pressable>
      )}

      {allReady && (
        <View style={styles.panel}>
          <Text style={styles.panelHead}>Loop</Text>
          <Text style={styles.kv}>
            {endpointer.listening
              ? phase === "speaking"
                ? bargeIn
                  ? "Speaking — talk to interrupt"
                  : "Speaking — please wait"
                : phase === "listening"
                  ? "Listening — just talk"
                  : phase
              : "Stopped"}
          </Text>
          <Pressable
            style={[styles.smallButton, { alignSelf: "stretch" }]}
            onPress={() => setBargeIn(!bargeIn)}
          >
            <Text style={styles.smallButtonText}>
              Mode: {bargeIn ? "Full-duplex (barge-in)" : "Half-duplex (speaker-safe)"}
              {"  ›  tap to switch"}
            </Text>
          </Pressable>
          {bargeIn && (
            <Text style={[styles.kv, { color: "#FBBF24" }]}>
              ⚠ Open-speaker barge-in needs the native AEC build or
              headphones, else the reply self-interrupts. Switch to
              half-duplex for a guaranteed open-speaker demo.
            </Text>
          )}
          <View style={styles.buttonRow}>
            {endpointer.listening ? (
              <Pressable
                style={[styles.smallButton, styles.stopBtn]}
                onPress={() => {
                  void endpointer.stopListening();
                  void cancelTtsAndPlayer();
                  setPhase("idle");
                }}
              >
                <Text style={styles.smallButtonText}>Stop loop</Text>
              </Pressable>
            ) : (
              <Pressable
                style={styles.smallButton}
                onPress={() => {
                  void endpointer.startListening();
                  setPhase("listening");
                }}
              >
                <Text style={styles.smallButtonText}>Resume loop</Text>
              </Pressable>
            )}
          </View>
        </View>
      )}

      {error && (
        <View style={[styles.panel, styles.errorPanel]}>
          <Text style={styles.panelHead}>Error</Text>
          <Text selectable style={styles.errorText}>
            {error}
          </Text>
        </View>
      )}

      {checkInEnded && (
        <View style={[styles.panel, { borderColor: "#34D399" }]}>
          <Text style={[styles.panelHead, { color: "#34D399" }]}>
            ✅ Check-in complete
          </Text>
          <Text selectable style={styles.toolCall}>
            🛠 {checkInEnded}
          </Text>
        </View>
      )}

      {messages.length > 0 && (
        <View style={styles.panel}>
          <Text style={styles.panelHead}>
            Conversation ({messages.filter((m) => m.role === "user").length}{" "}
            turns) · STT {fmtMs(stats.sttMs)} · LLM {fmtMs(stats.llmMs)} ·{" "}
            {stats.tps.toFixed(1)} tok/s
          </Text>
          {messages.map((m, i) => (
            <View
              key={i}
              style={[
                styles.msg,
                m.role === "user" ? styles.msgUser : styles.msgAsst,
              ]}
            >
              <Text style={styles.msgRole}>
                {m.role === "user" ? "You" : "Gemma"}
              </Text>
              {m.tool ? (
                <Text selectable style={styles.toolCall}>
                  🛠 {m.tool}
                </Text>
              ) : null}
              <Text selectable style={styles.outputText}>
                {m.pending ? "…" : m.text || "(empty)"}
              </Text>
            </View>
          ))}
        </View>
      )}

      {diag && (
        <View style={styles.panel}>
          <Text style={styles.panelHead}>Turn diagnostics</Text>
          <Text selectable style={styles.kv}>
            turn {diag.turn} · llm rawLen {diag.rawLen} · replyLen{" "}
            {diag.replyLen} · tts chunks {diag.ttsChunks} · ended{" "}
            {String(diag.ttsEnded)}
          </Text>
          <Text
            selectable
            style={[
              styles.kv,
              { color: diag.note === "ok" ? "#9CA3AF" : "#FBBF24" },
            ]}
          >
            {diag.note}
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

function SubsystemRow({
  label,
  status,
  detail,
}: {
  label: string;
  status: SubsystemState[keyof SubsystemState];
  detail?: string;
}) {
  const color =
    status === "ready"
      ? "#34D399"
      : status === "loading"
        ? "#FBBF24"
        : status === "error"
          ? "#F87171"
          : "#6B7280";
  return (
    <View style={styles.subRow}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={styles.subLabel}>{label}</Text>
      {detail && <Text style={styles.subDetail}>{detail}</Text>}
      <Text style={[styles.subStatus, { color }]}>{status}</Text>
    </View>
  );
}

function phaseStyle(p: Phase) {
  switch (p) {
    case "listening":
      return { color: "#34D399" };
    case "speaking":
      return { color: "#22D3EE" };
    case "transcribing":
    case "generating":
    case "loading":
      return { color: "#FBBF24" };
    case "error":
      return { color: "#F87171" };
    default:
      return { color: "#9CA3AF" };
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#08080C" },
  content: { padding: 16, gap: 12 },
  sub: { color: "#9CA3AF", fontSize: 13, lineHeight: 18 },
  subRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  subLabel: { color: "#F1F1F4", fontSize: 13, flex: 1 },
  subDetail: {
    color: "#9CA3AF",
    fontSize: 11,
    fontFamily: "Menlo",
    marginRight: 8,
  },
  subStatus: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
  },
  statusLabel: { color: "#9CA3AF", fontSize: 14 },
  statusValue: { fontSize: 14, fontWeight: "600" },
  panel: {
    backgroundColor: "#16161F",
    padding: 12,
    borderRadius: 8,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: "#23232F",
    gap: 4,
  },
  errorPanel: { borderColor: "#7F1D1D" },
  panelHead: {
    color: "#6B7280",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 4,
  },
  outputText: { color: "#F1F1F4", fontSize: 14, lineHeight: 20 },
  msg: {
    borderRadius: 8,
    borderCurve: "continuous",
    padding: 10,
    marginTop: 6,
    gap: 2,
  },
  msgUser: {
    backgroundColor: "#1C2230",
    borderWidth: 1,
    borderColor: "#2A3550",
    alignSelf: "flex-end",
    maxWidth: "92%",
  },
  msgAsst: {
    backgroundColor: "#16211B",
    borderWidth: 1,
    borderColor: "#23402F",
    alignSelf: "flex-start",
    maxWidth: "92%",
  },
  msgRole: {
    color: "#6B7280",
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  kv: { color: "#F1F1F4", fontSize: 13, fontFamily: "Menlo" },
  toolCall: {
    color: "#34D399",
    fontSize: 13,
    fontFamily: "Menlo",
    fontWeight: "700",
  },
  errorText: { color: "#F87171", fontSize: 13, fontFamily: "Menlo" },
  button: {
    backgroundColor: "#6366F1",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 6,
    borderCurve: "continuous",
  },
  buttonDisabled: { backgroundColor: "#3F3F50", opacity: 0.5 },
  buttonText: {
    color: "#F1F1F4",
    fontWeight: "600",
    fontSize: 14,
    textAlign: "center",
  },
  buttonRow: { flexDirection: "row", gap: 8, marginTop: 6 },
  smallButton: {
    alignSelf: "flex-start",
    backgroundColor: "#23232F",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
    borderCurve: "continuous",
  },
  stopBtn: { backgroundColor: "#7F1D1D" },
  smallButtonText: { color: "#F1F1F4", fontSize: 12, fontWeight: "600" },
});
