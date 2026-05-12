# Synthetic dataset generation and clinical safeguards

This document describes **how WAVE builds synthetic *draft* training rows** under `models/`, and **what we do to keep them as clinically appropriate as automated tooling allows**. It complements the runbook-style notes in [`SYNTHETIC_DATA.md`](SYNTHETIC_DATA.md) (unified session generator commands and disclosure checklist).

Synthetic data is **clinical-adjacent training material**, not a substitute for clinician-authored seeds, spot-check, or FDA-aligned pharmacology review. Anything accepted here must still be treated as **`synthetic_draft`** (or `draft` for phase-only JSONL) in manifests, training reports, and competition writeups.

---

## 1. Two different synthetic paths

We use **two** approaches on purpose: one maximizes **control and auditability** for early phase narration coverage; the other fills **stratified gaps** in the unified session dataset using a remote model only as a **proposal engine**, with all acceptance rules local.

| Path | Script | Draft engine | Primary use |
| --- | --- | --- | --- |
| **Phase narration expansion** | [`generate_phase_narration_synthetic.py`](generate_phase_narration_synthetic.py) | Deterministic templates + regex validators | Extra rows in the same JSONL shape as clinician phase seeds; reproducible with `--seed` |
| **Unified session gap-fill** | [`generate_wave_session_synthetic.py`](generate_wave_session_synthetic.py) | OpenAI Chat Completions (default `gpt-5-mini`) | `phase_narration` and `reflection` (and optionally rare check-in strata) after EDA shows underrepresentation |

Check-in dialogue at scale is primarily grown in the **client Synthetix** loop (seed → expand → clinician review → train), as described in the repo root [`AGENTS.md`](../AGENTS.md). The `models/` scripts focus on **normalizing** those sources and, where needed, **expanding** phase/reflection coverage for the unified `lora-wave-session` training file.

---

## 2. End-to-end data flow (unified session)

1. **Clinician and curated sources** are listed in [`prepare_wave_session_dataset.py`](prepare_wave_session_dataset.py) (`DEFAULT_SOURCE_FILES`). That script normalizes each row into the same **prompt + strict JSON output** shape the app uses for on-device JSON mode.
2. **Normalization output** is typically `datasets/lora-wave-session-normalized.jsonl` (regenerable; see [`SYNTHETIC_DATA.md`](SYNTHETIC_DATA.md)).
3. **`generate_wave_session_synthetic.py`** (without `--generate`) reads the normalized file, computes **coverage gaps** by `surface`, `sourceLoraId`, `chunkNumber`, `medicationStatus`, `trigger`, and optional final-turn flags, and writes `lora-wave-session-coverage-plan.json` plus audit stubs.
4. With **`--generate`** and **`OPENAI_API_KEY`**, the script proposes candidates, then **only merges rows that pass local gates** into `lora-wave-session-expanded.jsonl`, alongside machine and human-readable reports.

Synthetic rows are always traceable via metadata (`sourceStatus: synthetic_draft`, `scenarioSeed`, `generatorModel`, `generatorPromptHash`, `sourceCoverageGap`).

---

## 3. How phase narration synthetics are built

[`generate_phase_narration_synthetic.py`](generate_phase_narration_synthetic.py) is **template-based**, not LLM-generated. That choice trades variety for:

- **Reproducibility** (`--seed`, deterministic UUIDs for row ids).
- **Bounded language** (fixed clause libraries per chunk, aligned to MBRP-style chunk themes in `CHUNK_BRIEFS` inside [`prepare_wave_session_dataset.py`](prepare_wave_session_dataset.py)).
- **No API leakage** of prompts or patient-like text to a third party during this step.

### 3.1 Coverage grid

`build_coverage_plan()` walks a small grid of:

- `chunkNumber` 1–5  
- `medicationStatus` × `trigger` × `matType` (with sensible coupling, e.g. `none` medication status forces `matType: none`)  
- Intensity bands and correlated `latestCravingScore`  
- Optional `obstacleHint` for chunks after the first  

So synthetics **exercise the same structured dimensions** we stratify on at train/split time, rather than random free text.

### 3.2 Clinical-style constraints enforced in code

Each generated line is checked in `validate_row()`:

- Exactly **six** narration lines per chunk, length bounds, no embedded newlines.  
- **No toxic positivity** phrases (`TOXIC_POSITIVITY_RE`).  
- **No stage directions** or bracketed “breathe now” cues (`STAGE_DIRECTION_RE`)—the product uses audio/UI for pacing, not the model.  
- **No “chunk N” meta talk** (`PHASE_ANNOUNCEMENT_RE`).  
- **No medication directives** (`MEDICAL_DIRECTIVE_RE`)—aligned with WAVE’s rule that the app never tells someone to change a dose.

Medication-adjacent sentences in templates are **care-plan framing** (“information for your care plan”, “if available”) rather than dosing advice. Chunk five includes **support outreach** language (“trusted support person or care team”) that is **not** crisis hotline routing (which remains rule-based in the app).

Rows are labeled **`draft`** with `authorInitials: synthetic` and explicit notes until a clinician changes status.

---

## 4. How unified-session synthetics are built

Details and CLI examples: [`SYNTHETIC_DATA.md`](SYNTHETIC_DATA.md). Conceptually:

### 4.1 Gap-driven generation only

The script increases counts **only where the normalized dataset is short** relative to targets (defaults aim to lift `phase_narration` and `reflection` toward check-in scale). It does **not** inflate already-dense surfaces without a configured gap. That reduces redundant “more of the same” and keeps review surface manageable.

### 4.2 Same prompts and validators as real training rows

For every accepted candidate, the pipeline calls the same builders as prepared data:

- `build_phase_prompt`, `build_reflection_prompt`, or `build_check_in_prompt`  
- `build_prepared_row` with metadata wired for synthetic provenance  

Validation reuses **`validate_phase_output`**, **`validate_reflection_output`**, **`validate_check_in_output`**, and **`validate_common_output`** from [`prepare_wave_session_dataset.py`](prepare_wave_session_dataset.py). So a synthetic row cannot “sneak in” with a looser schema than a clinician-normalized row.

### 4.3 Prompting the draft model for tone, not for medical facts

The generator receives:

- A **system prompt** (`GENERATOR_SYSTEM_PROMPT` in `generate_wave_session_synthetic.py`) that states WAVE’s voice rules: trauma-informed second person, **no shame, no toxic positivity, no medication instructions, no crisis routing, no hallucinated pharmacology**, JSON only.  
- A **user prompt** with the coverage gap, **deterministic `scenario_seeds`**, and up to **four same-surface exemplars** from the existing dataset (`build_generation_prompt`). Instructions require **one candidate per seed**, **no copying exemplar wording**, and shapes that match production JSON.

The remote model is therefore asked to **imitate style and structure** grounded in real examples, not to invent new clinical claims. Structured fields (`medicationStatus`, `trigger`, intensities) come from the **gap and seed**, not from free-form model invention; normalization **overwrites** candidate inputs where needed so labels stay consistent.

### 4.4 Local acceptance gates (clinical safety and quality)

Before a row is appended:

1. **JSON + schema** for the surface.  
2. **`validate_common_output`**: toxic positivity, medication-directive regex, markdown/bullets.  
3. **Surface invariants** (e.g. six phase lines; reflection numeric insight and four `nextSteps` chips; check-in `endConversation` rules for final vs non-final turns).  
4. **Heuristic filters** in `score_quality()`: shame/relapse-blame patterns, generic platitudes list, crisis-routing tokens (988, SAMHSA, etc.—routing is app-owned).  
5. **Length distribution**: output length must fall within a band derived from **real** same-surface rows (rough guard against empty or absurdly long completions).  
6. **Rubric threshold** (default minimum score **85**): consolidates validation failures and second-person voice.  
7. **Deduplication**: canonical JSON hash, normalized text hash, scenario hash, **5-gram Jaccard** and **ROUGE-L** against existing same-surface text so near-copies of seeds or prior synthetics drop out.

Together, these steps **do not** guarantee clinical correctness; they **bound** the kinds of errors we will ship into training data and **force** disclosure-friendly provenance.

### 4.5 Test data policy

Per [`SYNTHETIC_DATA.md`](SYNTHETIC_DATA.md), **held-out evaluation should prefer clinician-source rows** when making base-vs-LoRA claims. Synthetics belong in **training experiments** and must be **counted and disclosed**.

---

## 5. What “as clinically accurate as possible” means here

In this repo, “as accurate as possible” is operationalized as **layered risk reduction**, not as a claim that the model output is medically verified.

| Layer | What it does |
| --- | --- |
| **Human seeds + PRD-aligned enums** | Medication status, triggers, and chunk structure come from the same constrained vocabularies used in product logic. |
| **Identical JSON and prompt contract** | Training examples match what Gemma sees at inference time, reducing distribution shift. |
| **Shared validators** | The same functions that reject bad normalized rows reject bad synthetics. |
| **Tone and safety regexes** | Block common harmful patterns (shame, generic toxic positivity, directive dosing language, hotline copy in training text). |
| **No pharmacology generation task** | Prompts do not ask the draft model for mechanisms, half-lives, or drug interaction content; medication lines stay high-level and aligned with app policy. |
| **Provenance + draft labels** | Every synthetic row remains auditable; nothing is silently treated as clinician-approved. |
| **Human review gate** | Per project rules, expanded data used for serious training/eval should still pass **clinician spot-check** on a sample before high-stakes claims. |

---

## 6. Artifacts to cite in papers or submissions

| Artifact | Role |
| --- | --- |
| [`datasets/lora-wave-session-coverage-plan.json`](datasets/lora-wave-session-coverage-plan.json) | Gap plan and targets |
| [`datasets/lora-wave-session-synthetic-report.json`](datasets/lora-wave-session-synthetic-report.json) | Counts, rejection reasons, thresholds |
| [`datasets/lora-wave-session-synthetic-quality-audit.md`](datasets/lora-wave-session-synthetic-quality-audit.md) | Human-readable audit snapshot |
| [`datasets/lora-wave-session-expanded.jsonl`](datasets/lora-wave-session-expanded.jsonl) | Normalized rows + accepted synthetics |

Regenerate or inspect these after changing seeds, targets, or source JSONL.

---

## 7. Related documentation

- [`SYNTHETIC_DATA.md`](SYNTHETIC_DATA.md) — commands, API key handling, disclosure checklist for expanded session data.  
- [`README.md`](README.md) — environment setup and LoRA experiment entry points.  
- [`../docs/model-training.md`](../docs/model-training.md) — train/test policy and ship gates.  
- [`../docs/models.md`](../docs/models.md) — which surfaces use which adapters and base-only crisis behavior.
