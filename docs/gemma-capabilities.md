# WAVE — Gemma 4 capability reference

> What Gemma 4 can do, what it cannot do, and which of those capabilities WAVE
> actually uses. Treat this as the answer to the question "can the base model
> do X?" before anyone designs a feature on top of it.
>
> For *which* Gemma model and LoRAs WAVE ships, see [`models.md`](./models.md).
> For the training pipeline, see [`model-training.md`](./model-training.md).

Sources used throughout this file:

- [Hugging Face — `google/gemma-4-E2B-it` model card](https://huggingface.co/google/gemma-4-E2B-it)
- [Gemma 4 — Google DeepMind](https://deepmind.google/models/gemma/gemma-4/)
- [Google AI for Developers — Gemma docs](https://ai.google.dev/gemma/docs)
- [Function calling with Gemma](https://ai.google.dev/gemma/docs/capabilities/function-calling)
- [vLLM Gemma 4 recipe](https://docs.vllm.ai/projects/recipes/en/latest/Google/Gemma4.html)
- [LiteRT Gemma 4 E2B-it build](https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm)
- [OpenAI Agents SDK — Models](https://openai.github.io/openai-agents-python/models/)

---

## Family at a glance

Gemma 4 (released April 2026) ships four instruction-tuned sizes. WAVE uses
**E2B only** — every other size in this table is listed for completeness and
to make trade-offs explicit.

| Size | Params | Active | Context | Modalities in | Modalities out | Where it can run |
|---|---|---|---|---|---|---|
| **E2B** *(WAVE)* | 2.3 B effective / 5.1 B w/ embeddings | dense | 128 K | text + image + audio | text | phone, browser (WebGPU), laptop |
| E4B | 4.5 B effective / 8 B w/ embeddings | dense | 128 K | text + image + audio | text | laptop, low-end GPU |
| 26 B A4B (MoE) | 25.2 B total | 3.8 B active | 256 K | text + image | text | consumer GPU |
| 31 B Dense | 30.7 B | dense | 256 K | text + image | text | workstation / server GPU |

Architecture notes that matter for product decisions:

- **Hybrid attention.** All sizes interleave 512–1024-token sliding-window
  layers with global layers. The final layer is always global. This is why the
  small models can hold 128 K context without LiteRT/WebGPU memory blowing up.
- **Per-Layer Embeddings (PLE)** on E2B and E4B. Each decoder layer has its
  own embedding table. The lookup tables are large on disk but cheap at
  inference, which is the whole reason the "effective" parameter count is so
  much smaller than the total.
- **Native `system` role.** Unlike Gemma 3, you no longer prepend the system
  prompt to the first user turn — `system`, `user`, `assistant` are all
  first-class.

---

## Modality support matrix

What you can put in, what comes out, and the hard limits.

| Modality | E2B | E4B | 26 B A4B | 31 B | Notes |
|---|:---:|:---:|:---:|:---:|---|
| Text in/out | ✅ | ✅ | ✅ | ✅ | Up to context length above. |
| Image in (variable aspect & resolution) | ✅ | ✅ | ✅ | ✅ | Visual token budget configurable: 70 / 140 / 280 / 560 / 1120. Higher = more detail (good for OCR / docs), lower = faster (good for captioning). |
| Image out (generation) | ❌ | ❌ | ❌ | ❌ | **Gemma 4 is text-out only.** No native image, audio, or video generation in any size. Pair with a separate model if you need this. |
| Video in (as frames) | ✅ | ✅ | ✅ | ✅ | Sampled at ~1 frame/sec. **Max ~60 seconds** of video per prompt. |
| Audio in (ASR + AST) | ✅ | ✅ | ❌ | ❌ | Only the small models. **Max 30 seconds** per audio segment. Supports automatic speech recognition and speech-to-translated-text across multiple languages. |
| Audio out (TTS) | ❌ | ❌ | ❌ | ❌ | Use a separate TTS model. |
| Interleaved text + image + audio in one prompt | ✅ | ✅ | text+image only | text+image only | Best practice: **place image/audio before text** in the message content array. |

**For WAVE specifically:** the production session path is **text-in, text-out**.
The MVP does not consume image, video, or audio inputs. The capability is
there in the base — we just do not use it. If a future surface (e.g. a "log
your day" voice journal) wants ASR, E2B already supports it without swapping
models.

---

## Reasoning, structure, and tools

### Thinking mode

Built into all four sizes. Triggered by injecting `<|think|>` at the top of
the system turn (most chat templates expose this as `enable_thinking=True`).
When enabled the model emits internal reasoning before the final answer using
`<|channel>thought\n…<|/channel>` markers; the rest of the response is the
user-visible answer.

| Property | Behaviour |
|---|---|
| Default state | Off in instruction-tuned models. |
| Enable | `enable_thinking=True` in the chat template, or prepend `<|think|>` manually. |
| Thinking content in chat history | **Strip it** before the next user turn. The HF `parse_response` helper does this for you. |
| Latency cost | Significant — thinking adds hundreds to thousands of tokens. |

**WAVE does not use thinking mode in the session path.** The 2-second response
budget for medication-aware acknowledgments and crisis triage cannot afford
extra reasoning tokens. We may use it offline for synthetic-data generation in
[`model-training.md`](./model-training.md), but never in production.

### Function calling / tool use

Native, on every instruction-tuned size, in the **OpenAI tool-call JSON
format**. You pass tools as JSON Schema:

```json
{
  "type": "function",
  "function": {
    "name": "get_dose_status",
    "description": "Look up whether the patient is on-time, late, or missed for their last MAT dose.",
    "parameters": {
      "type": "object",
      "properties": {
        "patient_id": { "type": "string" }
      },
      "required": ["patient_id"]
    }
  }
}
```

The model emits structured `tool_call` JSON when it decides to invoke a
function:

```json
{ "name": "get_dose_status", "arguments": { "patient_id": "abc-123" } }
```

vLLM, llama.cpp, and Transformers all parse this natively. The HF chat
template (visible in the model card) handles the formatting — you do not hand-
craft the tool grammar.

**For WAVE:** tool calls are allowed only for narrow control-plane signals, not
for clinical routing. The current temporary `/api/checkin` stand-in uses a
single `endConversation` tool call to signal that the check-in is complete; the
session state machine still owns the transition. The Adapter Manager chooses
LoRAs with rule-based routing (see [`models.md`](./models.md)), so the model is
never given a tool that can change medication, pick a hotline, write storage, or
route around the intake safety screen.

### JSON / structured output

The honest answer: **the Gemma weights themselves have no built-in "JSON mode"
flag**, but every serving stack you'd realistically use exposes one. So
whether Gemma "has a JSON mode" is a question about your runtime, not the
model.

Sources:
[Gemini API — Structured outputs](https://ai.google.dev/gemini-api/docs/structured-output),
[vLLM Gemma 4 recipe](https://docs.vllm.ai/projects/recipes/en/latest/Google/Gemma4.html),
[llama.cpp LLGuidance docs](https://github.com/ggml-org/llama.cpp/blob/master/docs/llguidance.md),
[Function calling with Gemma](https://ai.google.dev/gemma/docs/capabilities/function-calling).

| Serving path | JSON-mode equivalent | Strictness |
|---|---|---|
| **Vertex AI / Google AI Studio (hosted Gemma)** | `response_mime_type: "application/json"` + `response_schema` (a.k.a. "Controlled Generation") | Schema-enforced. Same flag the Gemini API uses. |
| **vLLM** (OpenAI-compatible server) | `response_format: {"type": "json_schema", …}` or `guided_json` | Schema-enforced via constrained decoding. |
| **llama.cpp / Ollama** | `response_format: {"type": "json_object"}` for "any valid JSON"; GBNF grammar or **LLGuidance** for full JSON-Schema enforcement | Schema-enforced when you supply a grammar/schema; ~50 µs/token with LLGuidance. |
| **Raw `transformers` / `transformers.js`** (what WAVE ships) | Nothing built-in | DIY: Outlines / LMQL / a custom `LogitsProcessor`, or rely on function calling. |
| **Native function calling** (any runtime) | Tool-call format itself is JSON; schema declared via JSON Schema in the tool definition | **Model-native** — Gemma 4 was trained on the OpenAI tool-call shape, so this is the only structured-output path that doesn't depend on the serving layer. |

A few things that follow from this table:

- "Just prompt it for JSON" works most of the time on E2B and fails enough
  that you should never rely on it for anything safety-critical.
- Function calling is the **recommended** path in Google's own Gemma docs
  precisely because it does not need any serving-side support.
- If you're moving between runtimes (e.g. dev on Transformers, prod on
  WebGPU), function calling is also the most portable option since the
  guarantee comes from the model, not the server.

**For WAVE specifically:** the final web runtime ships via `transformers.js` +
WebGPU, which has no built-in JSON mode. Where we need structured output, the
Gemma path will constrain on the prompt/tool shape, parse the output, validate
with Zod, retry once, then fall back to scripted local copy. The current
temporary OpenAI stand-ins use Responses API JSON Schema where useful
(`/api/narrate`, `/api/narrate/reflection`, `/api/insights`) so the client-side
contracts can stabilize before the Gemma swap.

---

## Languages

| Property | Value |
|---|---|
| Strong out-of-box | 35+ languages |
| Seen in pre-training | 140+ languages |
| Knowledge cutoff | January 2025 |

WAVE ships English-only for MVP. The capability for additional locales exists
in the base; what does not exist yet is the trauma-informed eval set in those
locales, which is what would actually make us comfortable shipping them.

---

## Coding & reasoning benchmarks (E2B only, since that's what we ship)

Selected from the model card. These are **base-model** numbers — no LoRA, no
WAVE prompt engineering.

| Benchmark | Gemma 4 E2B | Gemma 3 27B (no thinking) |
|---|---|---|
| MMLU Pro | 60.0 % | 67.6 % |
| AIME 2026 (no tools) | 37.5 % | 20.8 % |
| LiveCodeBench v6 | 44.0 % | 29.1 % |
| Codeforces ELO | 633 | 110 |
| GPQA Diamond | 43.4 % | 42.4 % |
| MMMU Pro (vision) | 44.2 % | 49.7 % |
| MATH-Vision | 52.4 % | 46.0 % |
| CoVoST (audio) | 33.47 | — |
| MRCR v2 8-needle 128 K | 19.1 % | 13.5 % |

E2B trails the much larger Gemma 3 27B on broad knowledge (MMLU Pro) and
vision understanding, but **beats it on every reasoning, coding, and long-
context benchmark in the table** while running on a phone. That trade is the
whole reason WAVE picked it.

---

## Runtime / serving support

| Runtime | Status | WAVE uses it |
|---|---|---|
| 🤗 Transformers (PyTorch) | First-class. Use `AutoModelForImageTextToText` for vision/audio, `AutoModelForCausalLM` for text-only. | Yes — for the developer-machine smoke test and LoRA training in [`models/`](../models/). |
| `transformers.js` + WebGPU | Supported on E2B/E4B (web `.task` build). | Final web-demo runtime. Temporary route handlers stand in today. |
| LiteRT-LM (`.litertlm`) | Official build for Android, iOS, Desktop, IoT. Hardware accel via XNNPack (CPU) and ML Drift (GPU). | Yes — post-hackathon mobile port. |
| vLLM | Native Gemma 4 support, including a dedicated `gemma4_utils` tool-call parser and OpenAI-compatible API. | Not yet — would be the play if we ever add a server-side surface. |
| llama.cpp / Ollama | Official GGUF builds, OpenAI-compatible HTTP. | Not yet. |
| Vertex AI / Google AI Studio | Hosted endpoints. | No — we are explicitly off-cloud for the session path. |

**Quantization.** The shipped runtime quantizes E2B to **INT4** (~1.5 GB on
disk) for the WebGPU build. Native precision is BF16 (~10 GB on disk for E2B);
INT8 sits in between. See [`model-training.md`](./model-training.md) §6.1 for
the export step.

---

## OpenAI ecosystem compatibility

Gemma is not an OpenAI model. It does **not** have a hosted endpoint that
speaks the OpenAI REST API out of the box. But everything that consumes the
"OpenAI shape" works against Gemma the moment you put an OpenAI-compatible
server in front of it.

| Tool / SDK | Works with Gemma? | How |
|---|---|---|
| **OpenAI Agents SDK** (`openai-agents-python`) | ✅ Indirectly | Point it at any OpenAI-compatible server hosting Gemma — Ollama (`http://localhost:11434/v1`), llama.cpp (`http://localhost:8080/v1`), or vLLM. Set `OPENAI_BASE_URL` or pass a custom `AsyncOpenAI(base_url=…)` to `set_default_openai_client`. Tool calls work because Gemma 4 emits the OpenAI tool-call shape natively. |
| **OpenAI tool / function calling format** | ✅ Native | Gemma 4's chat template ingests JSON-Schema tools and emits `{name, arguments}` JSON in the OpenAI shape. |
| **OpenAI-style `messages` ({role, content})** | ✅ Native | `system`, `user`, `assistant` are all first-class. Multimodal content uses the `[{"type":"image"|"audio"|"video"|"text", …}, …]` shape. |
| **OpenAI Responses API specifics** (tools like web_search, file_search) | ❌ | Those are server-side OpenAI features, not part of the chat protocol. Replicate them yourself if you need them. |
| **OpenAI Assistants API** | ❌ | Same — server-side product, not a model contract. |
| **LangChain / LlamaIndex / DSPy** | ✅ | Via the same OpenAI-compatible server pattern, or via the `transformers` integration. |

**For WAVE:** the settled architecture does not run an OpenAI-compatible server
in the session path; it calls Gemma directly through `transformers.js` in the
browser. The current checked-in web demo temporarily calls OpenAI `gpt-5-mini`
from Next.js Route Handlers while that runtime is unfinished. Those routes are
scaffolding, not the target serving architecture. The OpenAI Agents SDK is not
in our stack.

---

## What Gemma 4 explicitly cannot do

Calling these out so we never accidentally promise them in product copy.

- **No native image, audio, or video generation.** Text out only, every size.
- **No native TTS.** Pair with a separate TTS engine if you need voice output.
- **No web browsing, no built-in search, no built-in code execution.** Those
  are agent-loop features you build on top, not model features.
- **No persistent memory.** Context window is what you get; anything longer-
  lived is your storage layer.
- **No real-time / streaming audio in.** Audio is processed as ≤30-second
  clips, not as a live stream.
- **No first-party safety classifier in the weights.** Google ships
  [ShieldGemma](https://ai.google.dev/responsible/docs/safeguards/shieldgemma)
  as a separate model for that. WAVE does its own crisis-triage routing
  before the model ever sees a message.
- **No JSON-mode flag baked into the open weights.** JSON mode exists on
  every common runtime (Vertex `response_mime_type`, vLLM `response_format`,
  llama.cpp grammars/LLGuidance), but it's a serving-layer feature, not a
  model feature — see "JSON / structured output" above.

---

## Best-practice defaults (per Google's model card)

If you have no reason to deviate, use these:

| Setting | Value |
|---|---|
| `temperature` | 1.0 |
| `top_p` | 0.95 |
| `top_k` | 64 |
| `enable_thinking` | `False` for latency-bound surfaces, `True` for reasoning-heavy offline tasks |
| Image token budget | 280 (default) — go to 1120 only for OCR/document parsing |
| Multimodal ordering | image / audio / video **before** text in the message content array |
| Multi-turn history | strip the model's `<|channel>thought…` blocks before sending the next user turn |

WAVE's session-path overrides:

- `temperature=0.7` (warmer than 1.0 produces too much variance for trauma-
  informed phrasing; we want predictable softness, see the eval rubric in
  [`model-training.md`](./model-training.md)).
- `top_p=0.95`, `top_k=64` — kept at defaults.
- `enable_thinking=False` — non-negotiable on the session path.
