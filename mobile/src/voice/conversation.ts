// Pure, dependency-free conversation/turn state for the voice loop.
//
// Deliberately has ZERO React / React Native / audio imports so it can be
// unit-tested off-device (Node 24 runs this .ts directly) — which is the
// whole point: the transcript-overwrite and "2nd turn didn't respond"
// bugs are turn-state bugs, separable from VAD/Whisper/Kokoro. The screen
// owns audio + the real LiteRT instance; it injects `send` (the LLM call)
// and renders `messages`. Tests inject a scripted `send`.

export interface ConvMessage {
  role: "user" | "assistant";
  /** Patient-facing / spoken text (tool call already stripped). */
  text: string;
  /** Parsed endConversation tool call on the assistant turn, if any. */
  tool?: string | null;
  /** True until the assistant reply has been filled in. */
  pending?: boolean;
}

export interface TurnResult {
  reply: string;
  tool: string | null;
  raw: string;
}

/** The LLM call, injected so this module stays pure/testable. */
export type SendFn = (userText: string) => Promise<string>;

export interface TurnHooks {
  /** Fired whenever the message list changes (push a fresh snapshot to UI). */
  onChange?: (messages: readonly ConvMessage[]) => void;
}

// Native Gemma-4 tool-call shape: a plain reply then a literal
// endConversation{...}. Spoken/visible text = reply with that removed.
// Pure (no RN) so it lives here and the screen imports it instead of
// keeping a private copy.
export function extractToolCall(raw: string): {
  reply: string;
  tool: string | null;
} {
  // JSON output-contract (the mobile path): a single object
  // {"reply": "...", "endConversation": null | {cravingScore,obstacleCategory}}.
  // Read reply/tool from the parsed JSON, not the raw text.
  const jStart = raw.indexOf("{");
  const jEnd = raw.lastIndexOf("}");
  if (jStart !== -1 && jEnd > jStart) {
    try {
      const o = JSON.parse(raw.slice(jStart, jEnd + 1)) as {
        reply?: unknown;
        endConversation?: {
          cravingScore?: unknown;
          obstacleCategory?: unknown;
        } | null;
      };
      if (o && typeof o === "object" && "endConversation" in o) {
        const reply =
          typeof o.reply === "string" && o.reply.trim()
            ? o.reply.trim()
            : raw.trim();
        const ec = o.endConversation;
        if (ec && typeof ec === "object") {
          const score = String(ec.cravingScore ?? "?");
          const obst = String(ec.obstacleCategory ?? "none");
          return {
            reply,
            tool: `endConversation{cravingScore:${score},obstacleCategory:${obst}}`,
          };
        }
        return { reply, tool: null };
      }
    } catch {
      /* not valid JSON — fall through to the literal form */
    }
  }
  // Legacy literal fallback: endConversation{...} appended to prose.
  const m = raw.match(/endConversation\s*\{([^}]*)\}/i);
  if (!m) return { reply: raw.trim(), tool: null };
  const args = m[1] ?? "";
  const score = args.match(/cravingScore\s*[:=]\s*(\d+)/i)?.[1] ?? "?";
  const obst =
    args.match(/obstacleCategory\s*[:=]\s*"?([a-zA-Z_]+)"?/i)?.[1] ?? "none";
  return {
    reply: raw.replace(m[0], "").trim(),
    tool: `endConversation{cravingScore:${score},obstacleCategory:${obst}}`,
  };
}

// Deterministic end-of-check-in detector. Stock Gemma will not reliably
// set the structured endConversation field even when the patient clearly
// ends — so the APP decides termination from the patient's words (this
// is also how production check-in.ts owns turn/termination logic). The
// model's JSON endConversation is still honored if it ever fires.
const READY_RE =
  /\b(i'?m (ready|done|good to (go|continue)|good)|ready to (go|continue|keep going|move on)|let'?s (keep going|continue|go on|move on|do it|begin|start)|keep going|move on|next (one|part|chunk|section)|that'?s (all|it|enough)|we'?re done|i'?m finished|stop( now)?|end (the )?(check ?in|session))\b/i;

export function detectReadyToEnd(patientText: string): boolean {
  return READY_RE.test(patientText.trim());
}

/** Pull the first craving score (integer 1-10) the patient stated. */
export function parseCravingScore(text: string): number | null {
  const m = text.match(
    /\b(10|[1-9])\b|\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/i,
  );
  if (!m) return null;
  if (m[1]) return parseInt(m[1], 10);
  const words: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  };
  return words[(m[2] ?? "").toLowerCase()] ?? null;
}

// Deterministic output hygiene for voice. Stock Gemma 4 ignores
// "no emoji / no markdown" system instructions for casual inputs, and a
// voice agent must never speak "asterisk" or read an emoji — so we
// normalize in code instead of trusting the model (voice-AI best
// practice). Applied to the patient-facing reply only; the
// endConversation tool literal is parsed off before this runs.
export function sanitizeForVoice(input: string): string {
  let s = input;
  // Strip emoji / pictographs / symbol blocks + ZWJ + variation selectors.
  s = s.replace(
    /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F1E6}-\u{1F1FF}\u{2300}-\u{23FF}\u{2190}-\u{21FF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]/gu,
    "",
  );
  // Markdown links [label](url) -> label
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  // Headings / blockquote / list markers at line starts
  s = s.replace(/^[ \t]*#{1,6}[ \t]*/gm, "");
  s = s.replace(/^[ \t]*>[ \t]?/gm, "");
  s = s.replace(/^[ \t]*[-*+][ \t]+/gm, "");
  s = s.replace(/^[ \t]*\d+\.[ \t]+/gm, "");
  // Emphasis / code markers
  s = s.replace(/\*\*|__|~~|[*_`#]/g, "");
  // Quotation marks — the voice prompt bans them; the model still wraps
  // phrases in double quotes. Strip double quotes only (straight + curly);
  // leave ' ’ alone so contractions ("it's", "don't") survive in both
  // the spoken text and the visible transcript.
  s = s.replace(/["“”]/g, "");
  // Collapse whitespace/newlines into speakable prose.
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

export class ConversationController {
  private _messages: ConvMessage[] = [];
  private busy = false;
  private pending: string | null = null;

  /** Immutable-ish view for rendering. */
  get messages(): readonly ConvMessage[] {
    return this._messages;
  }

  /** Fresh array+object copy so React state identity changes on update. */
  snapshot(): ConvMessage[] {
    return this._messages.map((m) => ({ ...m }));
  }

  reset(): void {
    this._messages = [];
    this.busy = false;
    this.pending = null;
  }

  /**
   * Seed an opening agent turn (the session starts with WAVE speaking —
   * e.g. asking the craving score). No preceding user turn, so the
   * flattened transcript begins "WAVE: …".
   */
  seedAssistant(text: string): void {
    this._messages.push({ role: "assistant", text, tool: null });
  }

  /**
   * Run one turn: append the user message, call `send`, append the
   * assistant reply (tool call stripped). History ACCUMULATES — turn N
   * never overwrites turn N-1 (the reported bug). If a turn is already
   * in flight, the latest transcript is queued and run after (mirrors
   * the screen's single-resident-LLM serialization). Empty transcripts
   * are skipped. Returns the assistant result, null if skipped/queued.
   */
  async runTurn(
    transcript: string,
    send: SendFn,
    hooks?: TurnHooks,
  ): Promise<TurnResult | null> {
    const text = transcript.trim();
    if (!text) return null;
    if (this.busy) {
      this.pending = transcript; // latest wins
      return null;
    }
    this.busy = true;
    try {
      this._messages.push({ role: "user", text });
      const assistant: ConvMessage = {
        role: "assistant",
        text: "",
        tool: null,
        pending: true,
      };
      this._messages.push(assistant);
      hooks?.onChange?.(this.snapshot());

      const raw = await send(text);
      const { reply: rawReply, tool } = extractToolCall(raw);
      const reply = sanitizeForVoice(rawReply);
      assistant.text = reply;
      assistant.tool = tool;
      assistant.pending = false;
      hooks?.onChange?.(this.snapshot());

      return { reply, tool, raw };
    } finally {
      this.busy = false;
      const queued = this.pending;
      this.pending = null;
      if (queued != null) {
        await this.runTurn(queued, send, hooks);
      }
    }
  }
}
