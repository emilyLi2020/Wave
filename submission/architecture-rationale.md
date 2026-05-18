# WAVE — Two-Config Model Architecture: The Documented Why

## 1. Summary of the split

WAVE runs Gemma 4 E2B on-device in two different configurations, chosen per
surface and per runtime, for documented reasons — not by accident:

- **Frontend (primary demo path):** the **fine-tuned** Gemma (the
  `lora-wave-session` multitask LoRA, PEFT-merged into the base) shipped as a
  **Q4_K_M GGUF** and run through **wllama** over WebGPU/WASM. The fine-tune
  improves session/check-in/reflection quality, and wllama (llama.cpp) supports
  **strict `json_schema`** structured-output enforcement, so the JSON output
  contract is engine-enforced.
- **Backend / mobile (LiteRT prize path):** **base Gemma 4 E2B-it (NOT
  fine-tuned)** run through **LiteRT GPU**. Fine-tuning destroyed Gemma's
  native tool-calling capability via mode collapse (six failed training runs),
  and the public LiteRT-LM stack has **no working fine-tune conversion path**
  and **no engine-level JSON-schema enforcement** — so the base model is used
  with a prompt-contract + post-parse fallback instead.

Crisis and intake safety routing are rule-based code on both surfaces and never
use a LoRA (`docs/models.md:39`, `docs/models.md:285-313`, `AGENTS.md:54`).

---

## 2. Frontend — fine-tuned Gemma + wllama (Q4_K_M GGUF, WebGPU)

### 2.1 Why the fine-tune ships here

- The shipped browser session path is explicitly **base + the multitask LoRA
  merged into one artifact**: `docs/models.md:11-16` —
  *"The browser demo ships one base model plus one multitask LoRA merged into a
  single ONNX artifact … Gemma 4 E2B-it (INT4) + lora-wave-session -> merged
  ONNX demo model."* (The production runtime later moved from ONNX to GGUF via
  wllama; see 2.3.)
- The merge that feeds the production browser path is the PEFT merge of
  `Maelstrome/lora-wave-session-r32`: `models/finetune/README.md:3` —
  *"ships the LoRA at Maelstrome/lora-wave-session-r32 … The merged base +
  adapter feed the export pipelines under ../gguf/ (production browser path via
  wllama)…"* and `models/finetune/README.md:14` —
  *"The production session path runs Gemma 4 E2B-it via wllama + WebGPU/WASM in
  the browser."*
- The fine-tune is a multitask session LoRA covering exactly the three quality
  surfaces — phase narration (chunks 1–5), check-in turns, and the reflection
  card: `docs/models.md:83-92`. It is trained on clinician seed rows
  (`docs/models.md:79-80`, `models/finetune/README.md:7-13`).
- A single merged model is a deliberate browser-runtime choice: browser
  runtimes do not have mature LoRA hot-swap, so one merged download keeps the
  PWA simple: `docs/models.md:18-23` —
  *"Current browser runtimes such as Transformers.js + WebGPU do not provide
  mature production support for loading one base model and hot-swapping LoRA
  adapters in memory. Loading one merged model keeps the PWA demo simpler…"*
  Reinforced at `docs/models.md:90-92`.

### 2.2 Why wllama: strict json_schema structured output

- The structured-output strategy is split by surface and is engine-enforced:
  `client/lib/gemma/wllama-generators.ts:11-20` —
  chunk/reflection use `response_format: { type: 'json_object' }`, check-in
  uses `response_format: { type: 'json_schema', json_schema }` *"with a strict
  schema."*
- In production, even chunk and reflection were upgraded to **strict
  `json_schema`** because loose `json_object` mode was not reliable for the
  GGUF: `client/lib/gemma/wllama-generators.ts:102-112` —
  *"Strict json_schema — verified working on the fine-tune via
  /models/wllama-schema-probe. Loose json_object mode failed in production with
  array-comma syntax errors because llama.cpp does not strictly enforce JSON
  shape in that mode for our GGUF."* Same rationale for reflection at
  `client/lib/gemma/wllama-generators.ts:147-156`, and the check-in strict
  schema at `client/lib/gemma/wllama-generators.ts:206-236` and
  `:315-322`.
- Defense in depth: the engine-enforced JSON is still re-parsed and Zod-
  validated at the call site (`client/lib/gemma/wllama-generators.ts:14-15`,
  `:344-371`).
- The check-in surface trades streaming for reliable end-detection because the
  full JSON wrapper (`reply` + `endConversation`) has to land before `reply`
  can be extracted for TTS: `client/lib/gemma/wllama-generators.ts:17-20`.

### 2.3 Caveat on the GGUF path

`docs/models.md` still describes the merged artifact as ONNX
(`docs/models.md:11-16`), but `models/finetune/README.md:3,14` and
`client/lib/gemma/wllama-generators.ts` confirm the **production browser path
is GGUF via wllama**; ONNX is parked (`models/finetune/README.md:243,297`,
`models/finetune/README.md:30` notes the PEFT merge — not
`unsloth.save_pretrained_merged` — is required because the unsloth merge
produced all-`<pad>` output downstream). The GGUF pipeline is Q4_K_M, split for
the 2 GB ArrayBuffer ceiling: `models/finetune/README.md:242`.

---

## 3. Backend / mobile — base Gemma 4 E2B + LiteRT GPU

### 3.1 Why base, not fine-tuned: fine-tuning destroyed native tool-calling

`docs/postmortems/tool-call-finetune.md` is the primary source. Six training
runs (v1–v6), each a different dataset structure, all collapsed:

- Headline finding: `docs/postmortems/tool-call-finetune.md:3` —
  *"Base unsloth/gemma-4-E2B-it + matching prompt emits varied, contextually-
  correct tool calls 3-of-3 in token-level probing; the fine-tunes collapse to
  one canned response across all probed rows."*
- Empirical destruction of capability:
  `docs/postmortems/tool-call-finetune.md:104` (predicted ~5–10% tool-call rate
  at T=0.8, **observed 0/20**) and `:116-122` —
  the LoRA drove P(`<|tool_call>`) from base-Gemma's argmax mass down to
  `5×10⁻⁶`, *"a ~100,000× suppression … past argmax-flipping into functional
  destruction."*
- Root cause is structural (class imbalance + cross-entropy crushing the rare
  tool token): `docs/postmortems/tool-call-finetune.md:91-100`,
  `:124-154`, and the surviving lesson
  `:197` — *"Cross-entropy on rare tokens is brutally
  effective at suppression … The 'LoRA forgets less than full SFT' intuition
  does not generalize to rare-token control circuits."*
- v4/v5/v6 (structured `tool_calls`, system-prompt rewrite, native-shape
  target) all failed the same way: `docs/postmortems/tool-call-finetune.md:214-216`,
  `:227-228`, `:236`, `:274`.
- Base model emits the tool call correctly as plain text once the chat
  template injects the tool spec: `docs/postmortems/tool-call-finetune.md:244-259`
  and `:242` —
  *"With the fix, base Gemma 4 + v5/v6 prompts … reliably emit the tool call.
  The fine-tuned LoRAs still collapse."*
- The web frontend works around this by **not** using native tool calls: it
  keeps the JSON-wrapper / `json_schema` path instead
  (`docs/postmortems/tool-call-finetune.md:165`, `docs/models.md:243-249`).
  That mitigation is unavailable engine-side on LiteRT (see 3.3), which is why
  LiteRT uses the base model.

### 3.2 Why LiteRT-LM can't take the fine-tune at all

`docs/postmortems/litert-lm-mobile-finetune.md` documents that **no public
converter↔runtime pair loads the fine-tune on LiteRT-LM**:

- `docs/postmortems/litert-lm-mobile-finetune.md:1` —
  *"there is no public conversion–runtime pair that loads it."*
- `:13-21` — three bundle variants (MediaPipe Model
  Maker 5.07 GB; litert-torch 0.9.0 2.56 GB; litert-torch-nightly 2.56 GB) all
  rejected at engine creation; **stock** `litert-community/gemma-4-E2B-it.litertlm`
  loads cleanly on the same wrapper/device/backend.
- `:27-30` (TL;DR table) — every
  reproducible fine-tune bundle fails *"Failed to create LiteRT-LM engine"*;
  only Google's internally-tooled **stock** bundle loads and generates
  coherently.

There is therefore no LoRA merge/hot-swap path into LiteRT-LM: the only bundle
that runs is the stock (base) one.

### 3.3 Why prompt-contract instead of json_schema on LiteRT

- The LiteRT generators have no engine-level structured-output option:
  `mobile/src/runtime/litert-generators.ts:7-12` —
  *"The wrapper's LLMConfig has no response_format / grammar option. We rely on
  the existing `<output_contract>` prompt blocks + extractFirstJsonObject + Zod
  at the call site instead of engine-enforced JSON schema. Per plan: 'Drop
  json_schema for check-in, keep a strict JSON `<output_contract>` in the
  prompt, and parse the trailing endConversation field after stream end…'"*
- The check-in path flattens history into one user message and parses JSON
  out of free text after stream end (no schema enforcement):
  `mobile/src/runtime/litert-generators.ts:346-395`.
- Independently confirmed in the LiteRT limits research:
  `docs/postmortems/gemma4-litert-stock-limits-research.md:41` (TL;DR row) —
  *"JSON-schema-enforced output via llguidance — ❌ The Rust grammar deps are
  stubbed out in the iOS Bazel build"*; expanded at
  `docs/postmortems/gemma4-litert-stock-limits-research.md:146` —
  *"No engine-level JSON-schema enforcement is available … Reliability comes
  from Gemma 4's training, not from a grammar constraint."*
- Because reliability there comes from Gemma 4's *training*, the base model
  (whose native tool/structured behavior is intact) is the correct choice on
  LiteRT — the fine-tune both can't be loaded (3.2) and has its structured/
  tool behavior destroyed (3.1).

### 3.4 What actually ships on LiteRT (base + GPU, with caveats)

- The prize-eligible stock LiteRT demo is verified working on a physical
  iPhone 17 Pro: `docs/postmortems/gemma4-litert-stock-limits-research.md:26-31`,
  `:181-288`, `:362-368` —
  stock Gemma 4 E2B via a forked wrapper streamed JSON for the full
  ~1846-token chunk-1 prompt.
- It loads with GPU backend; the WAVE generators default the fine-tune config
  to CPU and the stock/voice path uses GPU:
  `mobile/src/runtime/litert-generators.ts:91-99`,
  `:201-214` (WAVE_CONFIG `backend: "cpu"` for the parked
  fine-tune bundle), and `gemma4-litert-stock-limits-research.md:227-236`
  (stock demo screens; `litert-generators.ts` parked fine-tune path noted as
  `4096 / 256`). AGENTS.md (root) confirms the mobile target:
  `AGENTS.md:45` — *"React Native + Expo, Gemma 4 E2B via LiteRT"* and
  `AGENTS.md:60-62` — production mobile roadmap loads *"the same LoRA stack"*
  once LiteRT LoRA support is production-ready (deferred, not shipped).

---

## 4. The split in one table

| Surface | Model | Runtime | Why (one line) |
|---|---|---|---|
| Frontend session (chunk / check-in / reflection) — **primary demo** | **Fine-tuned** Gemma (`lora-wave-session` PEFT-merged), Q4_K_M GGUF | **wllama** (llama.cpp), WebGPU/WASM | Fine-tune lifts clinical quality on the 3 session surfaces; wllama enforces **strict `json_schema`** so the JSON contract is engine-guaranteed (`docs/models.md:11-16`, `wllama-generators.ts:102-112`) |
| Mobile / LiteRT prize demo | **Base** Gemma 4 E2B-it (no LoRA) | **LiteRT-LM**, GPU | Fine-tuning **mode-collapsed** native tool-calling (`tool-call-finetune.md:3,116-122`); **no public LiteRT converter loads the fine-tune** (`litert-lm-mobile-finetune.md:1,27-30`) |
| Crisis triage | Base Gemma (only if copy needed) | n/a — rule-based code | Safety boundary must never be fine-tuned; routing is code (`docs/models.md:285-301`, `AGENTS.md:54`) |
| Intake safety screen | None | n/a — rule-based code | Both-yes substance+distress skips session; must stay code, not a model decision (`docs/models.md:303-313`) |

---

## 5. Caveats — shipped vs deferred

- **Frontend GGUF vs documented ONNX.** `docs/models.md:11-16` still says
  "merged ONNX." The authoritative production path is **GGUF via wllama**
  (`models/finetune/README.md:3,14,242`); ONNX is parked
  (`models/finetune/README.md:243,297`). The merge must be the PEFT merge, not
  `unsloth.save_pretrained_merged`, which produced all-`<pad>` output
  (`models/finetune/README.md:30,266`).
- **Native tool-calling fine-tune: abandoned.** Six runs (v1–v6) failed; B200
  paused pending external research
  (`docs/postmortems/tool-call-finetune.md:3,293-300`). The shipped fine-tune
  is the JSON-path `lora-wave-session-r32`, not a tool-calling adapter
  (`tool-call-finetune.md:165`, `models/finetune/README.md:3`).
- **LiteRT fine-tune delivery: deferred.** The mobile roadmap intends to load
  "the same LoRA stack" once LiteRT LoRA support is production-ready
  (`AGENTS.md:60-62`); today only the **stock/base** bundle loads
  (`litert-lm-mobile-finetune.md:27-30`). Hybrid recommendation in
  `gemma4-litert-stock-limits-research.md:309-314,323-340`: keep stock Gemma 4
  + LiteRT for the prize demo, ship llama.rn + GGUF for the fine-tune behavior
  on mobile later.
- **LiteRT stock ceilings.** Stock bundle is compiled ~2048 total / 256 decode;
  reflection + check-in + chunk-1 fit, chunks 2–5 / >256-token output do not
  (`gemma4-litert-stock-limits-research.md:286-288`).
- **Specialized per-surface LoRAs** (`lora-phase-narration`,
  `lora-check-in-1..5`, `lora-reflection`) are trained as demonstration
  artifacts only; not mounted in the browser demo due to immature browser LoRA
  hot-swap (`docs/models.md:24-37,108-117`).
- Insights (cross-session card) was **not** in the fine-tune mix — it runs the
  WAVE Gemma as a generic chat model with Zod validation only
  (`client/lib/gemma/wllama-generators.ts:168-172`).
