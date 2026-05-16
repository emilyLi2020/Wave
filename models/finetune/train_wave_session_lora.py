"""Train and evaluate the unified WAVE session LoRA.

This script consumes the normalized input/output JSONL produced by
`prepare_wave_session_dataset.py`, freezes train/validation/test splits, trains
Gemma 4 E2B-it with PEFT/TRL QLoRA, and evaluates base Gemma vs the selected
LoRA on held-out prompts.
"""

from __future__ import annotations

import argparse
import gc
import json
import math
import os
import random
import re
import shutil
import subprocess
import sys
import time
from collections import Counter
from contextlib import nullcontext
from dataclasses import asdict, dataclass, replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from prepare_wave_session_dataset import (
    CHECK_IN_MAX_REPLY_LENGTH,
    CHUNK_LINE_COUNT,
    DEFAULT_OUTPUT,
    DEMO_LORA_ID,
    MAX_LINE_LENGTH,
    MEDICAL_DIRECTIVE_RE,
    MIN_LINE_LENGTH,
    OBSTACLE_CATEGORIES,
    STAGE_DIRECTION_RE,
    TOXIC_POSITIVITY_RE,
    WAVE_JSON_SYSTEM_PROMPT,
)


DEFAULT_MODEL_ID = "unsloth/gemma-4-E2B-it"
JSON_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE | re.MULTILINE)
WORD_RE = re.compile(r"[a-z0-9']+")
MARKDOWN_OR_BULLET_RE = re.compile(r"(^|\n)\s*(?:#{1,6}\s|[-*]\s|\d+\.\s)")
ANALYSIS_VOICE_RE = re.compile(
    r"\b(session analysis|clinical interpretation|recommendations|patient profile|"
    r"data summary|therapeutic focus|strengths|areas for|next session)\b",
    re.IGNORECASE,
)
SECOND_PERSON_RE = re.compile(r"\b(you|your|yourself|you're|you've|you'll)\b", re.IGNORECASE)
PHASE_ANNOUNCEMENT_RE = re.compile(r"\b(?:chunk|phase)\s+\d\b", re.IGNORECASE)


def ensure_windows_utf8_mode() -> None:
    """TRL imports bundled templates that can fail under cp1252 on Windows."""
    if os.name != "nt" or sys.flags.utf8_mode:
        return
    if os.environ.get("WAVE_MODELS_UTF8_REEXECED") == "1":
        return
    env = os.environ.copy()
    env["PYTHONUTF8"] = "1"
    env["WAVE_MODELS_UTF8_REEXECED"] = "1"
    raise SystemExit(subprocess.call([sys.executable, "-X", "utf8", *sys.argv], env=env))


ensure_windows_utf8_mode()


@dataclass(frozen=True)
class Example:
    example_id: str
    surface: str
    prompt: str
    output_payload: dict[str, Any]
    metadata: dict[str, Any]
    messages: list[dict[str, str]]
    split_key: str


@dataclass(frozen=True)
class EvalResult:
    example_id: str
    surface: str
    source_lora_id: str
    source_status: str
    prompt: str
    reference: dict[str, Any]
    generated_text: str
    parsed_output: dict[str, Any] | None
    latency_seconds: float
    prompt_token_count: int
    generated_token_count: int
    tokens_per_second: float
    json_valid: bool
    schema_pass: bool
    safety_pass: bool
    medical_directive_pass: bool
    style_pass: bool
    patient_facing_pass: bool
    no_analysis_voice_pass: bool
    no_markdown_pass: bool
    phase_six_line_pass: bool
    reflection_next_step_pass: bool
    check_in_turn_sequence_pass: bool
    completion_nll: float
    completion_ppl: float
    completion_token_count: int
    token_f1: float
    rouge_l_f1: float
    errors: list[str]


@dataclass(frozen=True)
class TrainConfig:
    label: str
    epochs: float
    max_steps: int
    batch_size: int
    gradient_accumulation_steps: int
    learning_rate: float
    warmup_steps: int
    lora_r: int
    lora_alpha: int
    lora_dropout: float


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train WAVE lora-wave-session.")
    parser.add_argument("--data", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--output-dir", type=Path, default=None)
    parser.add_argument("--model-id", default=DEFAULT_MODEL_ID)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--validation-size", type=float, default=0.10)
    parser.add_argument("--test-size", type=float, default=0.10)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--skip-generation-eval", action="store_true")
    parser.add_argument(
        "--final-eval-mode",
        choices=("generation", "completion"),
        default="completion",
        help="Use generation gates or completion-only base-vs-LoRA comparison for the final test eval.",
    )
    parser.add_argument("--hparam-search", action="store_true")
    parser.add_argument("--max-search-runs", type=int, default=5)
    parser.add_argument("--min-validation-nll-improvement", type=float, default=0.005)
    parser.add_argument("--backend", choices=("unsloth", "peft"), default="unsloth")
    parser.add_argument(
        "--validation-eval-limit",
        type=int,
        default=0,
        help="Limit validation generation examples for fast sweeps. 0 evaluates all validation examples.",
    )
    parser.add_argument(
        "--validation-eval-mode",
        choices=("completion", "generation"),
        default="completion",
        help="Use completion NLL only for fast hyperparameter selection, or generation for full validation gates.",
    )
    parser.add_argument(
        "--generation-eval-limit",
        type=int,
        default=0,
        help="Limit final generation examples. 0 evaluates the full frozen test split.",
    )
    parser.add_argument(
        "--generation-eval-include-base",
        action="store_true",
        help="Also run slow base-model generation for final generation eval.",
    )
    parser.add_argument(
        "--generation-eval-include-completion-loss",
        action="store_true",
        help="Compute completion NLL inside generation eval. Completion eval mode already does this faster.",
    )
    parser.add_argument(
        "--generation-eval-load-mode",
        choices=("reuse", "4bit", "bf16"),
        default="4bit",
        help="How to load the selected adapter for generation eval. 4bit is safest; bf16 can be faster on large GPUs.",
    )
    parser.add_argument("--generation-eval-check-in-max-new-tokens", type=int, default=96)
    parser.add_argument("--generation-eval-phase-max-new-tokens", type=int, default=160)
    parser.add_argument("--generation-eval-reflection-max-new-tokens", type=int, default=192)
    parser.add_argument("--max-seq-length", type=int, default=3072)
    parser.add_argument("--max-new-tokens", type=int, default=420)
    parser.add_argument("--epochs", type=float, default=3.0)
    parser.add_argument("--max-steps", type=int, default=-1)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--gradient-accumulation-steps", type=int, default=8)
    parser.add_argument("--learning-rate", type=float, default=2e-4)
    parser.add_argument(
        "--warmup-steps",
        type=int,
        default=-1,
        help="Warmup steps. Use -1 to auto-compute 5%% of total optimizer steps.",
    )
    parser.add_argument("--weight-decay", type=float, default=0.001)
    parser.add_argument("--max-grad-norm", type=float, default=0.3)
    parser.add_argument("--lora-r", type=int, default=16)
    parser.add_argument("--lora-alpha", type=int, default=32)
    parser.add_argument("--lora-dropout", type=float, default=0.0)
    parser.add_argument("--save-steps", type=int, default=50)
    parser.add_argument("--save-total-limit", type=int, default=5)
    parser.add_argument("--resume-from-checkpoint", type=Path, default=None)
    parser.add_argument(
        "--allow-truncation",
        action="store_true",
        help="Allow training to continue when tokenized rows exceed --max-seq-length.",
    )
    parser.add_argument(
        "--no-4bit",
        action="store_true",
        help="Disable 4-bit QLoRA. Use only for smoke tests on non-CUDA machines.",
    )
    return parser.parse_args()


def default_output_dir() -> Path:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return Path("runs") / DEMO_LORA_ID / timestamp


def compact_json(value: dict[str, Any]) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def load_examples(path: Path) -> list[Example]:
    examples: list[Example] = []
    with path.open("r", encoding="utf-8") as file_handle:
        for line_number, line in enumerate(file_handle, start=1):
            stripped = line.strip()
            if not stripped:
                continue
            raw = json.loads(stripped)
            examples.append(normalize_prepared_example(raw, line_number))
    if not examples:
        raise ValueError(f"No examples found in {path}")
    return examples


def normalize_prepared_example(raw: dict[str, Any], line_number: int) -> Example:
    if raw.get("loraId") != DEMO_LORA_ID:
        raise ValueError(f"line {line_number}: expected loraId={DEMO_LORA_ID}")
    input_payload = raw.get("input")
    output_payload = raw.get("output")
    if not isinstance(input_payload, dict) or not isinstance(output_payload, dict):
        raise ValueError(f"line {line_number}: input/output must be objects")
    surface = input_payload.get("surface")
    prompt = input_payload.get("prompt")
    metadata = input_payload.get("metadata")
    if surface not in {"phase_narration", "check_in", "reflection"}:
        raise ValueError(f"line {line_number}: unsupported surface {surface!r}")
    if not isinstance(prompt, str) or not prompt.strip():
        raise ValueError(f"line {line_number}: input.prompt must be a non-empty string")
    if not isinstance(metadata, dict):
        raise ValueError(f"line {line_number}: input.metadata must be an object")
    errors = validate_output(surface, output_payload, metadata)
    if errors:
        raise ValueError(f"line {line_number}: {'; '.join(errors)}")
    messages = raw.get("messages")
    if not isinstance(messages, list) or len(messages) < 3:
        messages = [
            {"role": "system", "content": WAVE_JSON_SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
            {"role": "assistant", "content": compact_json(output_payload)},
        ]
    # Preserve full message structure including optional tool_calls fields
    # (added for v4's multi-turn tool-call protocol). Each message may have
    # `content` (string), `tool_calls` (list of structured calls), or both.
    preserved_messages: list[dict[str, Any]] = []
    for m in messages:
        kept: dict[str, Any] = {"role": str(m["role"])}
        if "content" in m and m["content"] is not None:
            kept["content"] = str(m["content"])
        if "tool_calls" in m:
            kept["tool_calls"] = m["tool_calls"]
        preserved_messages.append(kept)
    return Example(
        example_id=str(raw.get("id") or f"line-{line_number}"),
        surface=str(surface),
        prompt=prompt,
        output_payload=output_payload,
        metadata=metadata,
        messages=preserved_messages,
        split_key=str(raw.get("splitKey") or build_split_key(surface, metadata)),
    )


def build_split_key(surface: str, metadata: dict[str, Any]) -> str:
    return (
        f"surface={surface}|source={metadata.get('sourceLoraId')}|"
        f"chunk={metadata.get('chunkNumber')}|med={metadata.get('medicationStatus')}|"
        f"trigger={metadata.get('trigger')}"
    )


def split_examples(
    examples: list[Example],
    validation_size: float,
    test_size: float,
    seed: int,
) -> tuple[list[Example], list[Example], list[Example]]:
    if validation_size <= 0 or test_size <= 0 or validation_size + test_size >= 1:
        raise ValueError("validation/test sizes must be positive and sum to less than 1")
    if len(examples) < 10:
        raise ValueError("Need at least 10 examples for train/validation/test split")

    rng = random.Random(seed)
    indices = list(range(len(examples)))
    rng.shuffle(indices)
    validation_target = max(1, round(len(examples) * validation_size))
    test_target = max(1, round(len(examples) * test_size))
    remaining_by_key = Counter(example.split_key for example in examples)
    validation_indices = allocate_split(indices, examples, validation_target, remaining_by_key)
    test_indices = allocate_split(
        [index for index in indices if index not in validation_indices],
        examples,
        test_target,
        remaining_by_key,
    )

    for bucket in (validation_indices, test_indices):
        for index in indices:
            if len(bucket) >= (validation_target if bucket is validation_indices else test_target):
                break
            if index in validation_indices or index in test_indices:
                continue
            bucket.add(index)
            remaining_by_key[examples[index].split_key] -= 1

    train = [
        example
        for index, example in enumerate(examples)
        if index not in validation_indices and index not in test_indices
    ]
    validation = [example for index, example in enumerate(examples) if index in validation_indices]
    test = [example for index, example in enumerate(examples) if index in test_indices]
    return train, validation, test


def allocate_split(
    candidate_indices: list[int],
    examples: list[Example],
    target_count: int,
    remaining_by_key: Counter[str],
) -> set[int]:
    selected: set[int] = set()
    selected_surfaces: Counter[str] = Counter()
    for index in candidate_indices:
        if len(selected) >= target_count:
            break
        example = examples[index]
        if remaining_by_key[example.split_key] <= 1:
            continue
        selected.add(index)
        selected_surfaces[example.surface] += 1
        remaining_by_key[example.split_key] -= 1
    missing_surfaces = {example.surface for example in examples} - set(selected_surfaces)
    for surface in sorted(missing_surfaces):
        for index in candidate_indices:
            if len(selected) >= target_count:
                break
            if index in selected or examples[index].surface != surface:
                continue
            selected.add(index)
            remaining_by_key[examples[index].split_key] -= 1
            break
    return selected


def limit_examples(examples: list[Example], limit: int, seed: int) -> list[Example]:
    if limit <= 0 or limit >= len(examples):
        return examples
    by_surface: dict[str, list[Example]] = {}
    for example in examples:
        by_surface.setdefault(example.surface, []).append(example)
    rng = random.Random(seed)
    selected: list[Example] = []
    per_surface_target = max(1, limit // max(1, len(by_surface)))
    for surface_examples in by_surface.values():
        shuffled = list(surface_examples)
        rng.shuffle(shuffled)
        selected.extend(shuffled[:per_surface_target])
    remaining = [example for example in examples if example not in selected]
    rng.shuffle(remaining)
    selected.extend(remaining[: max(0, limit - len(selected))])
    return selected[:limit]


def write_jsonl(path: Path, examples: list[Example]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as file_handle:
        for example in examples:
            file_handle.write(json.dumps(asdict(example), ensure_ascii=False, separators=(",", ":")))
            file_handle.write("\n")


def estimate_total_training_steps(train_count: int, config: TrainConfig) -> int:
    if config.max_steps and config.max_steps > 0:
        return config.max_steps
    effective_batch_size = max(1, config.batch_size * config.gradient_accumulation_steps)
    steps_per_epoch = math.ceil(train_count / effective_batch_size)
    return max(1, math.ceil(steps_per_epoch * config.epochs))


def resolve_warmup_steps(train_count: int, config: TrainConfig) -> int:
    if config.warmup_steps >= 0:
        return config.warmup_steps
    total_steps = estimate_total_training_steps(train_count, config)
    return min(total_steps, max(5, round(total_steps * 0.05)))


def resolve_train_config(train_count: int, config: TrainConfig) -> TrainConfig:
    return replace(config, warmup_steps=resolve_warmup_steps(train_count, config))


def write_run_config(
    path: Path,
    args: argparse.Namespace,
    examples: list[Example],
    train: list[Example],
    validation: list[Example],
    test: list[Example],
) -> None:
    summary = {
        "resolvedTraining": {
            "totalSteps": estimate_total_training_steps(
                len(train),
                TrainConfig(
                    label="primary",
                    epochs=args.epochs,
                    max_steps=args.max_steps,
                    batch_size=args.batch_size,
                    gradient_accumulation_steps=args.gradient_accumulation_steps,
                    learning_rate=args.learning_rate,
                    warmup_steps=args.warmup_steps,
                    lora_r=args.lora_r,
                    lora_alpha=args.lora_alpha,
                    lora_dropout=args.lora_dropout,
                ),
            ),
            "warmupSteps": resolve_warmup_steps(
                len(train),
                TrainConfig(
                    label="primary",
                    epochs=args.epochs,
                    max_steps=args.max_steps,
                    batch_size=args.batch_size,
                    gradient_accumulation_steps=args.gradient_accumulation_steps,
                    learning_rate=args.learning_rate,
                    warmup_steps=args.warmup_steps,
                    lora_r=args.lora_r,
                    lora_alpha=args.lora_alpha,
                    lora_dropout=args.lora_dropout,
                ),
            ),
        },
        "loraId": DEMO_LORA_ID,
        "sourceData": str(args.data),
        "modelId": args.model_id,
        "seed": args.seed,
        "validationSize": args.validation_size,
        "testSize": args.test_size,
        "counts": {
            "total": len(examples),
            "train": summarize_examples(train),
            "validation": summarize_examples(validation),
            "test": summarize_examples(test),
            "all": summarize_examples(examples),
        },
        "training": {
            "promptStyle": "wave_session_input_output_json",
            "backend": args.backend,
            "maxSeqLength": args.max_seq_length,
            "maxNewTokens": args.max_new_tokens,
            "loadIn4bit": not args.no_4bit,
            "hparamSearch": args.hparam_search,
            "validationEvalLimit": args.validation_eval_limit,
            "validationEvalMode": args.validation_eval_mode,
            "finalEvalMode": args.final_eval_mode,
            "generationEvalLimit": args.generation_eval_limit,
            "generationEvalIncludeBase": args.generation_eval_include_base,
            "generationEvalIncludeCompletionLoss": args.generation_eval_include_completion_loss,
            "generationEvalLoadMode": args.generation_eval_load_mode,
            "generationEvalMaxNewTokensBySurface": {
                "check_in": args.generation_eval_check_in_max_new_tokens,
                "phase_narration": args.generation_eval_phase_max_new_tokens,
                "reflection": args.generation_eval_reflection_max_new_tokens,
            },
            "warmupSteps": args.warmup_steps,
            "weightDecay": args.weight_decay,
            "maxGradNorm": args.max_grad_norm,
            "saveSteps": args.save_steps,
            "saveTotalLimit": args.save_total_limit,
            "resumeFromCheckpoint": str(args.resume_from_checkpoint) if args.resume_from_checkpoint else None,
            "allowTruncation": args.allow_truncation,
        },
    }
    path.write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")


def summarize_examples(examples: list[Example]) -> dict[str, Any]:
    return {
        "count": len(examples),
        "bySurface": dict(sorted(Counter(example.surface for example in examples).items())),
        "bySourceLoraId": dict(
            sorted(Counter(str(example.metadata.get("sourceLoraId")) for example in examples).items())
        ),
        "byStatus": dict(
            sorted(Counter(str(example.metadata.get("sourceStatus")) for example in examples).items())
        ),
        "splitKeyCount": len(set(example.split_key for example in examples)),
    }


def import_training_dependencies() -> tuple[Any, ...]:
    from unsloth import FastModel
    from unsloth.chat_templates import get_chat_template, train_on_responses_only

    import torch
    from datasets import Dataset
    from peft import LoraConfig, prepare_model_for_kbit_training
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
    from trl import SFTConfig, SFTTrainer

    return (
        torch,
        Dataset,
        FastModel,
        get_chat_template,
        train_on_responses_only,
        LoraConfig,
        prepare_model_for_kbit_training,
        AutoModelForCausalLM,
        AutoTokenizer,
        BitsAndBytesConfig,
        SFTConfig,
        SFTTrainer,
    )


# Tool spec rendered into the prompt for check-in surface rows so the model
# learns to associate the tool schema in context with emitting native Gemma 4
# `<|tool_call>...<tool_call|>` tokens. Mirrors the spec used by the inference
# probe in `test_tool_calling.py` so train and inference distributions match.
END_CONVERSATION_TOOL: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "endConversation",
        "description": (
            "End the WAVE check-in after the patient is ready to continue."
        ),
        "parameters": {
            "type": "object",
            "required": ["cravingScore", "obstacleCategory"],
            "properties": {
                "cravingScore": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 10,
                    "description": "Patient's current craving score 1-10.",
                },
                "obstacleCategory": {
                    "type": "string",
                    "enum": [
                        "none",
                        "cannot_visualize",
                        "mind_wandering",
                        "urge_overwhelming",
                        "breath_tight",
                        "breath_anxiety",
                        "gave_in",
                        "guilt_failure",
                        "physical_discomfort",
                        "sleepiness",
                    ],
                },
            },
        },
    },
}


def tools_for_example(example: "Example") -> list[dict[str, Any]] | None:
    if example.surface == "check_in":
        return [END_CONVERSATION_TOOL]
    return None


def render_chat_text(
    tokenizer: Any,
    messages: list[dict[str, str]],
    add_generation_prompt: bool,
    tools: list[dict[str, Any]] | None = None,
) -> str:
    try:
        kwargs: dict[str, Any] = {
            "tokenize": False,
            "add_generation_prompt": add_generation_prompt,
        }
        if tools is not None:
            kwargs["tools"] = tools
        return tokenizer.apply_chat_template(messages, **kwargs)
    except Exception:
        rendered = []
        for message in messages:
            rendered.append(f"{message['role'].upper()}: {message['content']}")
        if add_generation_prompt:
            rendered.append("ASSISTANT:")
        return "\n".join(rendered)


def tokenize_text(tokenizer: Any, text: str, **kwargs: Any) -> Any:
    try:
        return tokenizer(text=text, **kwargs)
    except TypeError:
        return tokenizer(text, **kwargs)


def build_prompt_messages(example: Example) -> list[dict[str, str]]:
    """Return the [system, user] pair used for inference-time rendering.

    Prefer the row's own messages so any transform-time rewrites
    (v5 system prompt rewrite, v5/v6 task block rewrite) flow through to
    probes. Falls back to WAVE_JSON_SYSTEM_PROMPT + example.prompt for
    legacy rows (pre-v4) that don't carry a messages field.
    """
    msgs = example.messages
    if (
        msgs
        and len(msgs) >= 2
        and msgs[0].get("role") == "system"
        and msgs[1].get("role") == "user"
    ):
        return [
            {"role": "system", "content": msgs[0]["content"]},
            {"role": "user", "content": msgs[1]["content"]},
        ]
    return [
        {"role": "system", "content": WAVE_JSON_SYSTEM_PROMPT},
        {"role": "user", "content": example.prompt},
    ]


def build_full_messages(example: Example) -> list[dict[str, Any]]:
    # If the row provides a complete multi-message conversation (v4 multi-turn
    # tool protocol: system + user + assistant(tool_calls) + tool + assistant(content),
    # or v1-v3 single-assistant: system + user + assistant(content)), use it
    # verbatim so the chat template's tool-rendering branch fires correctly.
    msgs = example.messages
    has_multi_turn = (
        msgs
        and len(msgs) >= 3
        and msgs[0].get("role") == "system"
        and msgs[-1].get("role") == "assistant"
        and any(("tool_calls" in m) or m.get("content") for m in msgs[2:])
    )
    if has_multi_turn:
        return list(msgs)
    # Legacy fallback (no `messages` field on the row): synthesize a single
    # assistant turn from the structured output_payload.
    return [
        *build_prompt_messages(example),
        {"role": "assistant", "content": compact_json(example.output_payload)},
    ]


def build_hf_dataset(Dataset: Any, tokenizer: Any, examples: list[Example]) -> Any:
    rows = [
        {
            "id": example.example_id,
            "surface": example.surface,
            "text": render_chat_text(
                tokenizer,
                build_full_messages(example),
                add_generation_prompt=False,
                tools=tools_for_example(example),
            ).removeprefix("<bos>"),
        }
        for example in examples
    ]
    return Dataset.from_list(rows)


def percentile(sorted_values: list[int], value: float) -> int:
    if not sorted_values:
        return 0
    index = min(len(sorted_values) - 1, max(0, round((len(sorted_values) - 1) * value)))
    return int(sorted_values[index])


def count_input_ids(value: Any) -> int:
    shape = getattr(value, "shape", None)
    if shape is not None:
        if len(shape) == 0:
            return 1
        if len(shape) == 1:
            return int(shape[0])
        return int(shape[-1])
    if isinstance(value, list):
        if not value:
            return 0
        first = value[0]
        if isinstance(first, list):
            return len(first)
        return len(value)
    return len(value)


def write_token_length_report(
    path: Path,
    tokenizer: Any,
    examples: list[Example],
    max_seq_length: int,
    allow_truncation: bool = False,
) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    for example in examples:
        text = render_chat_text(
            tokenizer,
            build_full_messages(example),
            add_generation_prompt=False,
            tools=tools_for_example(example),
        ).removeprefix("<bos>")
        tokenized = tokenize_text(tokenizer, text, add_special_tokens=False)
        token_count = count_input_ids(tokenized["input_ids"])
        rows.append(
            {
                "id": example.example_id,
                "surface": example.surface,
                "sourceLoraId": example.metadata.get("sourceLoraId"),
                "sourceStatus": example.metadata.get("sourceStatus"),
                "tokens": token_count,
            }
        )

    lengths = sorted(row["tokens"] for row in rows)
    over_limit = [row for row in rows if row["tokens"] > max_seq_length]
    report = {
        "maxSeqLength": max_seq_length,
        "count": len(rows),
        "overLimitCount": len(over_limit),
        "stats": {
            "p50": percentile(lengths, 0.50),
            "p90": percentile(lengths, 0.90),
            "p95": percentile(lengths, 0.95),
            "p99": percentile(lengths, 0.99),
            "max": max(lengths) if lengths else 0,
        },
        "longestExamples": sorted(rows, key=lambda row: row["tokens"], reverse=True)[:20],
        "overLimitExamples": sorted(over_limit, key=lambda row: row["tokens"], reverse=True)[:50],
    }
    path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    if over_limit:
        message = (
            f"Token length preflight failed: {len(over_limit)} examples exceed "
            f"max_seq_length={max_seq_length}. See {path}."
        )
        if not allow_truncation:
            raise ValueError(f"{message} Re-run with --allow-truncation to continue anyway.")
        print(f"{message} Continuing because --allow-truncation was set.")
    else:
        print(
            f"Token length preflight passed: max={report['stats']['max']} <= "
            f"max_seq_length={max_seq_length}. Wrote {path}."
        )
    return report


def train_and_eval(
    args: argparse.Namespace,
    output_dir: Path,
    train: list[Example],
    validation: list[Example],
    test: list[Example],
) -> dict[str, Any]:
    (
        torch,
        Dataset,
        FastModel,
        get_chat_template,
        train_on_responses_only,
        LoraConfig,
        prepare_model_for_kbit_training,
        AutoModelForCausalLM,
        AutoTokenizer,
        BitsAndBytesConfig,
        SFTConfig,
        SFTTrainer,
    ) = import_training_dependencies()

    search_configs = build_search_configs(args)
    tuning_summary: list[dict[str, Any]] = []
    best_run: dict[str, Any] | None = None

    for index, requested_config in enumerate(search_configs, start=1):
        config = resolve_train_config(len(train), requested_config)
        candidate_dir = output_dir if len(search_configs) == 1 else output_dir / f"candidate-{index:02d}-{config.label}"
        candidate_dir.mkdir(parents=True, exist_ok=True)
        print(f"Training candidate {index}/{len(search_configs)}: {config}")

        candidate_started_at = time.perf_counter()
        if torch.cuda.is_available():
            torch.cuda.reset_peak_memory_stats()

        if args.backend == "unsloth":
            model, tokenizer = load_unsloth_model(args, FastModel, get_chat_template)
            model = add_unsloth_lora(model, FastModel, config, args.max_seq_length)
        else:
            tokenizer = AutoTokenizer.from_pretrained(args.model_id)
            if tokenizer.pad_token is None:
                tokenizer.pad_token = tokenizer.eos_token
            tokenizer.padding_side = "right"
            model = load_model(args, torch, AutoModelForCausalLM, BitsAndBytesConfig)
            if not args.no_4bit:
                model = prepare_model_for_kbit_training(model, use_gradient_checkpointing=True)
        model.config.use_cache = False

        write_token_length_report(
            candidate_dir / "token-length-report.json",
            tokenizer,
            [*train, *validation, *test],
            args.max_seq_length,
            args.allow_truncation,
        )

        train_dataset = build_hf_dataset(Dataset, tokenizer, train)
        validation_dataset = build_hf_dataset(Dataset, tokenizer, validation)

        peft_config = None
        if args.backend == "peft":
            peft_config = LoraConfig(
                r=config.lora_r,
                lora_alpha=config.lora_alpha,
                lora_dropout=config.lora_dropout,
                bias="none",
                task_type="CAUSAL_LM",
                target_modules=(
                    r"^model\.language_model\.layers\.\d+\."
                    r"(self_attn\.(q_proj|k_proj|v_proj|o_proj)|"
                    r"mlp\.(gate_proj|up_proj|down_proj))$"
                ),
            )
        training_args = SFTConfig(
            output_dir=str(candidate_dir / "checkpoints"),
            dataset_text_field="text",
            max_length=args.max_seq_length,
            packing=False,
            per_device_train_batch_size=config.batch_size,
            gradient_accumulation_steps=config.gradient_accumulation_steps,
            num_train_epochs=config.epochs,
            max_steps=config.max_steps,
            learning_rate=config.learning_rate,
            warmup_steps=config.warmup_steps,
            lr_scheduler_type="linear",
            logging_steps=1,
            eval_strategy="no",
            save_strategy="steps",
            save_steps=args.save_steps,
            save_total_limit=args.save_total_limit,
            report_to=[],
            optim="adamw_8bit" if not args.no_4bit else "adamw_torch",
            weight_decay=args.weight_decay,
            max_grad_norm=args.max_grad_norm,
            seed=args.seed,
            gradient_checkpointing=True,
            gradient_checkpointing_kwargs={"use_reentrant": False},
        )
        trainer_kwargs = {
            "model": model,
            "args": training_args,
            "train_dataset": train_dataset,
            "eval_dataset": validation_dataset,
            "processing_class": tokenizer,
        }
        if peft_config is not None:
            trainer_kwargs["peft_config"] = peft_config
        trainer = SFTTrainer(**trainer_kwargs)
        if args.backend == "unsloth":
            trainer = train_on_responses_only(
                trainer,
                instruction_part="<|turn>user\n",
                response_part="<|turn>model\n",
            )
        trainer.train(
            resume_from_checkpoint=str(args.resume_from_checkpoint)
            if args.resume_from_checkpoint
            else None
        )
        validation_metrics: dict[str, Any] = {}
        adapter_dir = candidate_dir / "adapter"
        trainer.save_model(str(adapter_dir))
        tokenizer.save_pretrained(str(adapter_dir))

        validation_eval_examples = limit_examples(validation, args.validation_eval_limit, args.seed)
        if args.validation_eval_mode == "generation":
            validation_report = evaluate_model_on_examples(
                args=args,
                model=trainer.model,
                tokenizer=tokenizer,
                examples=validation_eval_examples,
                torch=torch,
                label=f"{config.label}-validation",
            )
        else:
            validation_report = evaluate_completion_only_on_examples(
                model=trainer.model,
                tokenizer=tokenizer,
                examples=validation_eval_examples,
                torch=torch,
                label=f"{config.label}-validation-completion",
            )
        validation_nll = float(validation_report["metrics"]["completionNll"])
        history = trainer.state.log_history
        telemetry = training_telemetry(candidate_started_at, torch)
        candidate_summary = {
            "label": config.label,
            "config": asdict(config),
            "backend": args.backend,
            "adapterDir": str(adapter_dir),
            "trainerValidationMetrics": validation_metrics,
            "validationGenerationMetrics": validation_report["metrics"],
            "telemetry": telemetry,
            "adapterUpdateCheck": inspect_adapter_update(adapter_dir, torch),
            "logHistory": history,
            "accepted": False,
            "reason": "not selected",
        }
        (candidate_dir / "validation-eval.json").write_text(
            json.dumps(validation_report, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

        keep_model_for_final_eval = not args.hparam_search and not args.skip_generation_eval
        if best_run is None or validation_nll < best_run["validationNll"]:
            if best_run is not None and "model" in best_run:
                unload_model(best_run["model"], best_run["tokenizer"], torch)
            best_run = {
                "validationNll": validation_nll,
                "config": config,
                "candidateDir": candidate_dir,
                "adapterDir": adapter_dir,
                "summary": candidate_summary,
            }
            if keep_model_for_final_eval:
                best_run["model"] = trainer.model
                best_run["tokenizer"] = tokenizer
            else:
                unload_model(trainer.model, tokenizer, torch)
        else:
            unload_model(trainer.model, tokenizer, torch)

        if not keep_model_for_final_eval:
            del trainer
            del model
            del tokenizer
            gc.collect()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()

        tuning_summary.append(candidate_summary)

        if not args.hparam_search:
            break

    if best_run is None:
        raise RuntimeError("No training candidates completed")

    for item in tuning_summary:
        if item["label"] == best_run["config"].label:
            item["accepted"] = True
            item["reason"] = "lowest validation completion NLL"
    (output_dir / "tuning-summary.json").write_text(
        json.dumps(tuning_summary, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    final_adapter_dir = output_dir / "adapter"
    if best_run["adapterDir"] != final_adapter_dir:
        if final_adapter_dir.exists():
            shutil.rmtree(final_adapter_dir)
        shutil.copytree(best_run["adapterDir"], final_adapter_dir)

    eval_report: dict[str, Any] = {
        "loraId": DEMO_LORA_ID,
        "selectedConfig": asdict(best_run["config"]),
        "validationNll": best_run["validationNll"],
    }
    if not args.skip_generation_eval:
        if args.final_eval_mode == "completion":
            if "model" not in best_run or "tokenizer" not in best_run:
                raise RuntimeError(
                    "Completion eval after hparam search requires reusing the selected model. "
                    "Run the selected config as a single final training job without --hparam-search."
                )
            eval_report = run_completion_eval(
                model=best_run["model"],
                tokenizer=best_run["tokenizer"],
                test=test,
                torch=torch,
                selected_config=best_run["config"],
            )
        else:
            generation_loaded_fresh = False
            if args.generation_eval_load_mode == "reuse":
                if "model" not in best_run or "tokenizer" not in best_run:
                    raise RuntimeError(
                        "Generation eval load mode 'reuse' requires an in-memory selected model. "
                        "Use --generation-eval-load-mode 4bit or bf16 after hparam search."
                    )
                generation_model = best_run["model"]
                generation_tokenizer = best_run["tokenizer"]
                generation_model = prepare_generation_model(generation_model, generation_tokenizer, FastModel)
            else:
                if "model" in best_run and "tokenizer" in best_run:
                    unload_model(best_run["model"], best_run["tokenizer"], torch)
                    del best_run["model"]
                    del best_run["tokenizer"]
                generation_model, generation_tokenizer, actual_load_mode = load_unsloth_generation_model(
                    args=args,
                    adapter_dir=final_adapter_dir,
                    FastModel=FastModel,
                    get_chat_template=get_chat_template,
                    torch=torch,
                )
                args.generation_eval_load_mode = actual_load_mode
                generation_loaded_fresh = True
            eval_report = run_generation_eval(
                args=args,
                model=generation_model,
                tokenizer=generation_tokenizer,
                test=test,
                torch=torch,
                selected_config=best_run["config"],
                output_dir=output_dir,
            )
            if generation_loaded_fresh:
                unload_model(generation_model, generation_tokenizer, torch)
        eval_report["adapterUpdateCheck"] = inspect_adapter_update(final_adapter_dir, torch)
        eval_report["trainingBackend"] = args.backend
        (output_dir / "eval.json").write_text(
            json.dumps(eval_report, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        write_readme(output_dir / "README.md", eval_report)

    return eval_report


def build_search_configs(args: argparse.Namespace) -> list[TrainConfig]:
    primary = TrainConfig(
        label="primary",
        epochs=args.epochs,
        max_steps=args.max_steps,
        batch_size=args.batch_size,
        gradient_accumulation_steps=args.gradient_accumulation_steps,
        learning_rate=args.learning_rate,
        warmup_steps=args.warmup_steps,
        lora_r=args.lora_r,
        lora_alpha=args.lora_alpha,
        lora_dropout=args.lora_dropout,
    )
    if not args.hparam_search:
        return [primary]
    candidates = [
        primary,
        replace(primary, label="r8-a16-lr2e-4-e2", lora_r=8, lora_alpha=16, learning_rate=2e-4, epochs=2),
        replace(primary, label="r16-a32-lr1e-4-e2", learning_rate=1e-4, epochs=2),
        replace(primary, label="r16-a32-lr5e-5-e3", learning_rate=5e-5, epochs=3),
        replace(primary, label="r8-a16-lr5e-5-drop0-e3", lora_r=8, lora_alpha=16, learning_rate=5e-5, lora_dropout=0.0, epochs=3),
    ]
    deduped: list[TrainConfig] = []
    seen: set[tuple[Any, ...]] = set()
    for candidate in candidates:
        key = (
            candidate.epochs,
            candidate.max_steps,
            candidate.learning_rate,
            candidate.lora_r,
            candidate.lora_alpha,
            candidate.lora_dropout,
        )
        if key not in seen:
            deduped.append(candidate)
            seen.add(key)
    return deduped[: args.max_search_runs]


def load_unsloth_model(args: argparse.Namespace, FastModel: Any, get_chat_template: Any) -> tuple[Any, Any]:
    model, tokenizer = FastModel.from_pretrained(
        model_name=args.model_id,
        dtype=None,
        max_seq_length=args.max_seq_length,
        load_in_4bit=not args.no_4bit,
        full_finetuning=False,
    )
    # Unsloth's `gemma-4` chat template silently ignores the `tools=` argument,
    # which means our tool-spec preamble never reaches the rendered training
    # text. Preserve the base tokenizer's template (which renders tools
    # natively via `<|tool>declaration:...<tool|>`) so train and inference
    # distributions match. The base template still uses the `<|turn>user\n` /
    # `<|turn>model\n` markers that `train_on_responses_only` expects.
    base_template = tokenizer.chat_template
    tokenizer = get_chat_template(tokenizer, chat_template="gemma-4")
    if base_template:
        tokenizer.chat_template = base_template
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    tokenizer.padding_side = "right"
    return model, tokenizer


def load_unsloth_generation_model(
    args: argparse.Namespace,
    adapter_dir: Path,
    FastModel: Any,
    get_chat_template: Any,
    torch: Any,
) -> tuple[Any, Any, str]:
    load_mode = args.generation_eval_load_mode
    attempted_modes = [load_mode]
    if load_mode == "bf16":
        attempted_modes.append("4bit")

    last_error: Exception | None = None
    for mode in attempted_modes:
        kwargs: dict[str, Any] = {
            "model_name": str(adapter_dir),
            "dtype": torch.bfloat16 if mode == "bf16" and torch.cuda.is_available() else None,
            "max_seq_length": args.max_seq_length,
            "load_in_4bit": mode != "bf16",
            "full_finetuning": False,
        }
        if mode == "bf16":
            kwargs["load_in_16bit"] = True
        try:
            model, tokenizer = FastModel.from_pretrained(**kwargs)
        except TypeError as error:
            if mode != "bf16" or "load_in_16bit" not in kwargs:
                last_error = error
                continue
            kwargs.pop("load_in_16bit")
            try:
                model, tokenizer = FastModel.from_pretrained(**kwargs)
            except Exception as fallback_error:  # pragma: no cover - depends on local runtime
                last_error = fallback_error
                continue
        except Exception as error:  # pragma: no cover - depends on local runtime
            last_error = error
            continue

        # Mirror load_unsloth_model: preserve base tokenizer's chat template so
        # tools= survives apply_chat_template for inference.
        base_template = tokenizer.chat_template
        tokenizer = get_chat_template(tokenizer, chat_template="gemma-4")
        if base_template:
            tokenizer.chat_template = base_template
        if tokenizer.pad_token is None:
            tokenizer.pad_token = tokenizer.eos_token
        tokenizer.padding_side = "right"
        return prepare_generation_model(model, tokenizer, FastModel), tokenizer, mode

    raise RuntimeError(f"Could not load generation adapter from {adapter_dir}: {last_error}")


def prepare_generation_model(model: Any, tokenizer: Any, FastModel: Any | None = None) -> Any:
    disable_gradient_checkpointing = getattr(model, "gradient_checkpointing_disable", None)
    if callable(disable_gradient_checkpointing):
        disable_gradient_checkpointing()

    config = getattr(model, "config", None)
    if config is not None:
        config.use_cache = True

    generation_config = getattr(model, "generation_config", None)
    if generation_config is not None:
        generation_config.use_cache = True

    if FastModel is not None:
        for_inference = getattr(FastModel, "for_inference", None)
        if callable(for_inference):
            maybe_model = for_inference(model)
            if maybe_model is not None:
                model = maybe_model

    model.eval()
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    tokenizer.padding_side = "right"
    return model


def add_unsloth_lora(model: Any, FastModel: Any, config: TrainConfig, max_seq_length: int) -> Any:
    return FastModel.get_peft_model(
        model,
        finetune_vision_layers=False,
        finetune_language_layers=True,
        finetune_attention_modules=True,
        finetune_mlp_modules=True,
        r=config.lora_r,
        lora_alpha=config.lora_alpha,
        lora_dropout=config.lora_dropout,
        bias="none",
        use_gradient_checkpointing="unsloth",
        random_state=3407,
        max_seq_length=max_seq_length,
    )


def load_model(args: argparse.Namespace, torch: Any, AutoModelForCausalLM: Any, BitsAndBytesConfig: Any) -> Any:
    has_cuda = torch.cuda.is_available()
    if has_cuda and torch.cuda.is_bf16_supported():
        compute_dtype = torch.bfloat16
    elif has_cuda:
        compute_dtype = torch.float16
    else:
        compute_dtype = torch.float32
    model_kwargs: dict[str, Any] = {"torch_dtype": compute_dtype}
    if has_cuda:
        model_kwargs["device_map"] = "auto"
    if not args.no_4bit:
        if not has_cuda:
            raise RuntimeError(
                "4-bit QLoRA requires CUDA. Re-run with --no-4bit for a CPU smoke test."
            )
        model_kwargs["quantization_config"] = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=compute_dtype,
            bnb_4bit_use_double_quant=True,
        )
    return AutoModelForCausalLM.from_pretrained(args.model_id, **model_kwargs)


def training_telemetry(started_at: float, torch: Any) -> dict[str, Any]:
    telemetry: dict[str, Any] = {
        "elapsedSeconds": round(time.perf_counter() - started_at, 3),
    }
    if torch.cuda.is_available():
        telemetry.update(
            {
                "gpuName": torch.cuda.get_device_name(0),
                "peakAllocatedGb": round(torch.cuda.max_memory_allocated() / (1024**3), 3),
                "peakReservedGb": round(torch.cuda.max_memory_reserved() / (1024**3), 3),
            }
        )
    return telemetry


def inspect_adapter_update(adapter_dir: Path, torch: Any) -> dict[str, Any]:
    adapter_path = adapter_dir / "adapter_model.safetensors"
    if not adapter_path.exists():
        return {"available": False, "reason": f"{adapter_path} not found"}
    try:
        from safetensors.torch import load_file
    except Exception as error:
        return {"available": False, "reason": f"could not import safetensors: {error}"}
    state_dict = load_file(str(adapter_path), device="cpu")
    lora_b_tensors = [tensor for key, tensor in state_dict.items() if "lora_B" in key]
    lora_a_tensors = [tensor for key, tensor in state_dict.items() if "lora_A" in key]
    trainable_params = sum(int(tensor.numel()) for tensor in state_dict.values())
    b_total_norm = sum(float(tensor.float().norm().item()) for tensor in lora_b_tensors)
    return {
        "available": True,
        "adapterPath": str(adapter_path),
        "tensorCount": len(state_dict),
        "trainableParameterCount": trainable_params,
        "loraATensorCount": len(lora_a_tensors),
        "loraBTensorCount": len(lora_b_tensors),
        "loraBTotalNorm": b_total_norm,
        "loraBZeroTensorCount": sum(
            1 for tensor in lora_b_tensors if float(tensor.float().norm().item()) == 0.0
        ),
    }


def unload_model(model: Any, tokenizer: Any, torch: Any) -> None:
    del model
    del tokenizer
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


def adapter_disabled_context(model: Any) -> Any:
    disable_adapter = getattr(model, "disable_adapter", None)
    if callable(disable_adapter):
        return disable_adapter()
    return nullcontext()


def run_generation_eval(
    args: argparse.Namespace,
    model: Any,
    tokenizer: Any,
    test: list[Example],
    torch: Any,
    selected_config: TrainConfig,
    output_dir: Path,
) -> dict[str, Any]:
    generation_examples = limit_examples(test, args.generation_eval_limit, args.seed)
    progress_path = output_dir / "generation-eval-progress.jsonl"
    if progress_path.exists():
        progress_path.unlink()

    lora_report = evaluate_model_on_examples(
        args=args,
        model=model,
        tokenizer=tokenizer,
        examples=generation_examples,
        torch=torch,
        label="lora-test-generation",
        include_completion_loss=args.generation_eval_include_completion_loss,
        progress_path=progress_path,
    )
    base_report = None
    if args.generation_eval_include_base:
        with adapter_disabled_context(model):
            base_report = evaluate_model_on_examples(
                args=args,
                model=model,
                tokenizer=tokenizer,
                examples=generation_examples,
                torch=torch,
                label="base-test-generation",
                include_completion_loss=args.generation_eval_include_completion_loss,
                progress_path=progress_path,
            )
        comparison = compare_eval_reports(base_report, lora_report)
    else:
        comparison = {
            "baseGenerationSkipped": True,
            "reason": "Pass --generation-eval-include-base to run slow base-model generation gates.",
            "betterThanBase": None,
        }
    return {
        "loraId": DEMO_LORA_ID,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "selectedConfig": asdict(selected_config),
        "metrics": lora_report["metrics"],
        "comparison": comparison,
        "base": base_report,
        "lora": lora_report,
        "generationEval": {
            "exampleLimit": args.generation_eval_limit,
            "evaluatedExamples": len(generation_examples),
            "includeBase": args.generation_eval_include_base,
            "includeCompletionLoss": args.generation_eval_include_completion_loss,
            "loadMode": args.generation_eval_load_mode,
            "progressPath": str(progress_path),
        },
        "notes": [
            "LoRA generation gates are evaluated on the frozen test prompts.",
            "Base generation is skipped by default because completion eval already provides the base-vs-LoRA numeric comparison.",
            "Validation selected the LoRA candidate; the test split is used only for the final claim.",
            "Completion NLL/perplexity are included only when --generation-eval-include-completion-loss is set.",
            "Schema, safety, medication, and surface-specific rates verify WAVE behavior.",
        ],
    }


def run_completion_eval(
    model: Any,
    tokenizer: Any,
    test: list[Example],
    torch: Any,
    selected_config: TrainConfig,
) -> dict[str, Any]:
    lora_report = evaluate_completion_only_on_examples(
        model=model,
        tokenizer=tokenizer,
        examples=test,
        torch=torch,
        label="lora-test-completion",
    )
    with adapter_disabled_context(model):
        base_report = evaluate_completion_only_on_examples(
            model=model,
            tokenizer=tokenizer,
            examples=test,
            torch=torch,
            label="base-test-completion",
        )
    comparison = compare_completion_reports(base_report, lora_report)
    return {
        "loraId": DEMO_LORA_ID,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "selectedConfig": asdict(selected_config),
        "metrics": lora_report["metrics"],
        "comparison": comparison,
        "base": base_report,
        "lora": lora_report,
        "notes": [
            "Base and LoRA are evaluated on the same frozen test prompts.",
            "Completion NLL/perplexity measure likelihood of the reference JSON completion.",
            "Generation gate eval is intentionally skipped in this mode.",
        ],
    }


def generation_max_new_tokens(args: argparse.Namespace, surface: str) -> int:
    per_surface = {
        "check_in": args.generation_eval_check_in_max_new_tokens,
        "phase_narration": args.generation_eval_phase_max_new_tokens,
        "reflection": args.generation_eval_reflection_max_new_tokens,
    }
    surface_limit = per_surface.get(surface, args.max_new_tokens)
    return max(1, min(args.max_new_tokens, surface_limit))


def evaluate_model_on_examples(
    args: argparse.Namespace,
    model: Any,
    tokenizer: Any,
    examples: list[Example],
    torch: Any,
    label: str,
    include_completion_loss: bool = True,
    progress_path: Path | None = None,
) -> dict[str, Any]:
    model.eval()
    results: list[EvalResult] = []
    for index, example in enumerate(examples, start=1):
        if include_completion_loss:
            completion_nll, completion_ppl, completion_token_count = compute_completion_loss(
                model=model,
                tokenizer=tokenizer,
                example=example,
                torch=torch,
            )
        else:
            completion_nll, completion_ppl, completion_token_count = 0.0, 0.0, 0
        prompt_messages = build_prompt_messages(example)
        prompt_text = render_chat_text(
            tokenizer, prompt_messages, add_generation_prompt=True,
            tools=tools_for_example(example),
        )
        device = next(model.parameters()).device
        inputs = tokenize_text(
            tokenizer,
            prompt_text,
            return_tensors="pt",
            add_special_tokens=False,
        ).to(device)
        prompt_token_count = int(inputs["input_ids"].shape[-1])
        max_new_tokens = generation_max_new_tokens(args, example.surface)
        print(
            f"[{label}] {index}/{len(examples)} {example.surface} "
            f"prompt_tokens={prompt_token_count} max_new_tokens={max_new_tokens}",
            flush=True,
        )
        start = time.perf_counter()
        with torch.inference_mode():
            output_ids = model.generate(
                **inputs,
                max_new_tokens=max_new_tokens,
                do_sample=False,
                use_cache=True,
                pad_token_id=tokenizer.pad_token_id,
                eos_token_id=tokenizer.eos_token_id,
            )
        latency_seconds = time.perf_counter() - start
        generated_ids = output_ids[0][inputs["input_ids"].shape[-1] :]
        generated_token_count = int(generated_ids.shape[-1])
        tokens_per_second = generated_token_count / latency_seconds if latency_seconds > 0 else 0.0
        generated_text = tokenizer.decode(generated_ids, skip_special_tokens=True).strip()
        parsed_output, parse_errors = extract_json_object(generated_text)
        validation_errors = (
            validate_output(example.surface, parsed_output, example.metadata) if parsed_output else []
        )
        reference_text = flatten_output_text(example.output_payload)
        generated_style_text = flatten_output_text(parsed_output) if parsed_output else generated_text
        style_errors = style_check_errors(generated_style_text)
        token_f1 = bag_of_words_f1(generated_style_text, reference_text)
        rouge_l_f1 = rouge_l(generated_style_text, reference_text)
        surface_passes = surface_specific_passes(example.surface, parsed_output, example.metadata)

        result = EvalResult(
            example_id=example.example_id,
            surface=example.surface,
            source_lora_id=str(example.metadata.get("sourceLoraId")),
            source_status=str(example.metadata.get("sourceStatus")),
            prompt=example.prompt,
            reference=example.output_payload,
            generated_text=generated_text,
            parsed_output=parsed_output,
            latency_seconds=latency_seconds,
            prompt_token_count=prompt_token_count,
            generated_token_count=generated_token_count,
            tokens_per_second=tokens_per_second,
            json_valid=parsed_output is not None,
            schema_pass=parsed_output is not None and not validation_errors,
            safety_pass=not any(
                [
                    TOXIC_POSITIVITY_RE.search(generated_style_text),
                    STAGE_DIRECTION_RE.search(generated_style_text),
                    PHASE_ANNOUNCEMENT_RE.search(generated_style_text),
                ]
            ),
            medical_directive_pass=not MEDICAL_DIRECTIVE_RE.search(generated_style_text),
            style_pass=not style_errors,
            patient_facing_pass=bool(SECOND_PERSON_RE.search(generated_style_text)),
            no_analysis_voice_pass=not ANALYSIS_VOICE_RE.search(generated_style_text),
            no_markdown_pass=not MARKDOWN_OR_BULLET_RE.search(generated_style_text),
            phase_six_line_pass=surface_passes["phaseSixLine"],
            reflection_next_step_pass=surface_passes["reflectionNextStep"],
            check_in_turn_sequence_pass=surface_passes["checkInTurnSequence"],
            completion_nll=completion_nll,
            completion_ppl=completion_ppl,
            completion_token_count=completion_token_count,
            token_f1=token_f1,
            rouge_l_f1=rouge_l_f1,
            errors=[*parse_errors, *validation_errors, *style_errors],
        )
        results.append(result)
        print(
            f"[{label}] {index}/{len(examples)} done "
            f"latency={latency_seconds:.2f}s generated_tokens={generated_token_count} "
            f"tokens_per_second={tokens_per_second:.2f} json={result.json_valid} "
            f"schema={result.schema_pass} errors={len(result.errors)}",
            flush=True,
        )
        if progress_path is not None:
            with progress_path.open("a", encoding="utf-8") as progress_handle:
                progress_handle.write(json.dumps({"label": label, **asdict(result)}, ensure_ascii=False) + "\n")
    return aggregate_eval(results, label)


def evaluate_completion_only_on_examples(
    model: Any,
    tokenizer: Any,
    examples: list[Example],
    torch: Any,
    label: str,
) -> dict[str, Any]:
    model.eval()
    completion_results = []
    for example in examples:
        completion_nll, completion_ppl, completion_token_count = compute_completion_loss(
            model=model,
            tokenizer=tokenizer,
            example=example,
            torch=torch,
        )
        completion_results.append(
            {
                "exampleId": example.example_id,
                "surface": example.surface,
                "sourceLoraId": str(example.metadata.get("sourceLoraId")),
                "sourceStatus": str(example.metadata.get("sourceStatus")),
                "completionNll": completion_nll,
                "completionPpl": completion_ppl,
                "completionTokenCount": completion_token_count,
            }
        )
    metrics = {
        "exampleCount": len(completion_results),
        "bySurface": dict(sorted(Counter(result["surface"] for result in completion_results).items())),
        "completionNll": weighted_mean(
            (result["completionNll"], result["completionTokenCount"]) for result in completion_results
        ),
    }
    metrics["completionPpl"] = safe_exp(metrics["completionNll"])
    return {
        "label": label,
        "loraId": DEMO_LORA_ID,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "metrics": metrics,
        "examples": completion_results,
    }


def compute_completion_loss(model: Any, tokenizer: Any, example: Example, torch: Any) -> tuple[float, float, int]:
    tools = tools_for_example(example)
    prompt_text = render_chat_text(
        tokenizer, build_prompt_messages(example), add_generation_prompt=True, tools=tools,
    )
    full_text = render_chat_text(
        tokenizer, build_full_messages(example), add_generation_prompt=False, tools=tools,
    )
    prompt_ids = tokenize_text(tokenizer, prompt_text, add_special_tokens=False)["input_ids"]
    encoded = tokenize_text(tokenizer, full_text, return_tensors="pt", add_special_tokens=False)
    device = next(model.parameters()).device
    encoded = encoded.to(device)
    labels = encoded["input_ids"].clone()
    prompt_len = min(len(prompt_ids), labels.shape[-1])
    labels[:, :prompt_len] = -100
    token_count = int((labels != -100).sum().item())
    if token_count == 0:
        return float("nan"), float("nan"), 0
    with torch.no_grad():
        output = model(**encoded, labels=labels, use_cache=False)
    nll = float(output.loss.detach().cpu().item())
    return nll, math.exp(min(nll, 20.0)), token_count


def extract_json_object(text: str) -> tuple[dict[str, Any] | None, list[str]]:
    cleaned = JSON_FENCE_RE.sub("", text).strip()
    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, dict):
            return parsed, []
        return None, ["generated JSON was not an object"]
    except json.JSONDecodeError:
        pass
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None, ["no JSON object found in generated text"]
    try:
        parsed = json.loads(cleaned[start : end + 1])
    except json.JSONDecodeError as error:
        return None, [f"generated JSON parse error: {error}"]
    if not isinstance(parsed, dict):
        return None, ["generated JSON was not an object"]
    return parsed, []


def validate_output(surface: str, output_payload: dict[str, Any] | None, metadata: dict[str, Any]) -> list[str]:
    if not isinstance(output_payload, dict):
        return ["output must be an object"]
    if surface == "phase_narration":
        return validate_phase_output(output_payload)
    if surface == "check_in":
        return validate_check_in_output(output_payload, metadata)
    if surface == "reflection":
        return validate_reflection_output(output_payload)
    return [f"unsupported surface {surface!r}"]


def validate_phase_output(output_payload: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    lines = output_payload.get("lines")
    if not isinstance(lines, list):
        return ["output.lines must be an array"]
    if len(lines) != CHUNK_LINE_COUNT:
        errors.append(f"output.lines must contain exactly {CHUNK_LINE_COUNT} lines")
    for index, line in enumerate(lines):
        label = f"lines[{index}]"
        if not isinstance(line, str):
            errors.append(f"{label} must be a string")
            continue
        if not MIN_LINE_LENGTH <= len(line.strip()) <= MAX_LINE_LENGTH:
            errors.append(f"{label} length is out of bounds")
        if "\n" in line:
            errors.append(f"{label} contains a line break")
    return errors


def validate_check_in_output(output_payload: dict[str, Any], metadata: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    allowed_keys = {"reply", "endConversation"}
    extra_keys = set(output_payload) - allowed_keys
    if extra_keys:
        errors.append(f"check-in output has extra keys: {sorted(extra_keys)}")
    reply = output_payload.get("reply")
    end_conversation = output_payload.get("endConversation")
    if not isinstance(reply, str) or not 1 <= len(reply) <= CHECK_IN_MAX_REPLY_LENGTH:
        errors.append(f"reply must be 1-{CHECK_IN_MAX_REPLY_LENGTH} characters")
    final_turn = bool(metadata.get("isFinalAgentTurn"))
    if final_turn and not isinstance(end_conversation, dict):
        errors.append("final check-in turn must include endConversation object")
    if not final_turn and end_conversation is not None:
        errors.append("intermediate check-in turn must have endConversation=null")
    if isinstance(end_conversation, dict):
        if end_conversation.get("action") != "end":
            errors.append("endConversation.action must be end")
        score = end_conversation.get("cravingScore")
        if not isinstance(score, int) or not 1 <= score <= 10:
            errors.append("endConversation.cravingScore must be integer 1-10")
        obstacle = end_conversation.get("obstacleCategory")
        if obstacle is not None and obstacle not in OBSTACLE_CATEGORIES:
            errors.append("endConversation.obstacleCategory is invalid")
    return errors


def validate_reflection_output(output_payload: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    insight = output_payload.get("insight")
    question = output_payload.get("journalPromptQuestion")
    next_steps = output_payload.get("nextSteps")
    if not isinstance(insight, str) or not 10 <= len(insight) <= 500:
        errors.append("insight must be 10-500 characters")
    elif not re.search(r"\d", insight):
        errors.append("insight must contain the numeric ending intensity")
    if not isinstance(question, str) or not 10 <= len(question) <= 200:
        errors.append("journalPromptQuestion must be 10-200 characters")
    if not isinstance(next_steps, dict):
        errors.append("nextSteps must be an object")
    else:
        for key in ("one", "two", "three", "four"):
            value = next_steps.get(key)
            if not isinstance(value, str) or not 3 <= len(value) <= 80:
                errors.append(f"nextSteps.{key} must be 3-80 characters")
    return errors


def surface_specific_passes(
    surface: str,
    parsed_output: dict[str, Any] | None,
    metadata: dict[str, Any],
) -> dict[str, bool]:
    if parsed_output is None:
        return {
            "phaseSixLine": surface != "phase_narration",
            "reflectionNextStep": surface != "reflection",
            "checkInTurnSequence": surface != "check_in",
        }
    return {
        "phaseSixLine": surface != "phase_narration" or not validate_phase_output(parsed_output),
        "reflectionNextStep": surface != "reflection" or reflection_next_step_pass(parsed_output),
        "checkInTurnSequence": surface != "check_in" or check_in_turn_sequence_pass(parsed_output, metadata),
    }


def reflection_next_step_pass(output_payload: dict[str, Any]) -> bool:
    next_steps = output_payload.get("nextSteps")
    if not isinstance(next_steps, dict):
        return False
    return all(
        isinstance(next_steps.get(key), str) and 3 <= len(next_steps[key]) <= 80
        for key in ("one", "two", "three", "four")
    )


def check_in_turn_sequence_pass(output_payload: dict[str, Any], metadata: dict[str, Any]) -> bool:
    final_turn = bool(metadata.get("isFinalAgentTurn"))
    end_conversation = output_payload.get("endConversation")
    if final_turn:
        return isinstance(end_conversation, dict) and end_conversation.get("action") == "end"
    return end_conversation is None


def flatten_output_text(output_payload: dict[str, Any] | None) -> str:
    if not isinstance(output_payload, dict):
        return ""
    parts: list[str] = []
    for value in output_payload.values():
        if isinstance(value, str):
            parts.append(value)
        elif isinstance(value, list):
            parts.extend(item for item in value if isinstance(item, str))
        elif isinstance(value, dict):
            parts.extend(str(item) for item in value.values() if isinstance(item, str))
    return " ".join(parts)


def style_check_errors(text: str) -> list[str]:
    errors: list[str] = []
    if ANALYSIS_VOICE_RE.search(text):
        errors.append("analysis voice detected")
    if MARKDOWN_OR_BULLET_RE.search(text):
        errors.append("markdown or bullet formatting detected")
    return errors


def tokenize_words(text: str) -> list[str]:
    return WORD_RE.findall(text.lower())


def bag_of_words_f1(generated: str, reference: str) -> float:
    generated_tokens = tokenize_words(generated)
    reference_tokens = tokenize_words(reference)
    if not generated_tokens or not reference_tokens:
        return 0.0
    generated_counts = Counter(generated_tokens)
    reference_counts = Counter(reference_tokens)
    overlap = sum(min(count, reference_counts.get(token, 0)) for token, count in generated_counts.items())
    precision = overlap / len(generated_tokens)
    recall = overlap / len(reference_tokens)
    if precision + recall == 0:
        return 0.0
    return 2 * precision * recall / (precision + recall)


def rouge_l(generated: str, reference: str) -> float:
    generated_tokens = tokenize_words(generated)
    reference_tokens = tokenize_words(reference)
    if not generated_tokens or not reference_tokens:
        return 0.0
    lcs = longest_common_subsequence_length(generated_tokens, reference_tokens)
    precision = lcs / len(generated_tokens)
    recall = lcs / len(reference_tokens)
    if precision + recall == 0:
        return 0.0
    return 2 * precision * recall / (precision + recall)


def longest_common_subsequence_length(left: list[str], right: list[str]) -> int:
    previous = [0] * (len(right) + 1)
    for left_token in left:
        current = [0]
        for index, right_token in enumerate(right, start=1):
            current.append(previous[index - 1] + 1 if left_token == right_token else max(previous[index], current[-1]))
        previous = current
    return previous[-1]


def aggregate_eval(results: list[EvalResult], label: str) -> dict[str, Any]:
    metrics = compute_eval_metrics(results)
    return {
        "label": label,
        "loraId": DEMO_LORA_ID,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "metrics": metrics,
        "breakdowns": {
            "bySurface": grouped_eval_metrics(results, "surface"),
            "bySourceLoraId": grouped_eval_metrics(results, "source_lora_id"),
            "bySourceStatus": grouped_eval_metrics(results, "source_status"),
        },
        "examples": [asdict(result) for result in results],
    }


def compute_eval_metrics(results: list[EvalResult]) -> dict[str, Any]:
    latencies = sorted(result.latency_seconds for result in results)
    generated_token_counts = [result.generated_token_count for result in results]
    completion_nll = weighted_mean(
        (result.completion_nll, result.completion_token_count) for result in results
    )
    metrics = {
        "exampleCount": len(results),
        "bySurface": dict(sorted(Counter(result.surface for result in results).items())),
        "jsonValidityRate": mean_bool(result.json_valid for result in results),
        "schemaPassRate": mean_bool(result.schema_pass for result in results),
        "safetyPassRate": mean_bool(result.safety_pass for result in results),
        "medicalDirectivePassRate": mean_bool(result.medical_directive_pass for result in results),
        "stylePassRate": mean_bool(result.style_pass for result in results),
        "patientFacingRate": mean_bool(result.patient_facing_pass for result in results),
        "noAnalysisVoiceRate": mean_bool(result.no_analysis_voice_pass for result in results),
        "noMarkdownRate": mean_bool(result.no_markdown_pass for result in results),
        "phaseSixLinePassRate": mean_bool(result.phase_six_line_pass for result in results),
        "reflectionNextStepPassRate": mean_bool(result.reflection_next_step_pass for result in results),
        "checkInTurnSequencePassRate": mean_bool(result.check_in_turn_sequence_pass for result in results),
        "meanTokenF1": mean_float(result.token_f1 for result in results),
        "meanRougeLF1": mean_float(result.rouge_l_f1 for result in results),
        "meanLatencySeconds": mean_float(result.latency_seconds for result in results),
        "p50LatencySeconds": percentile(latencies, 0.50),
        "p95LatencySeconds": percentile(latencies, 0.95),
        "totalGeneratedTokens": sum(generated_token_counts),
        "meanGeneratedTokens": mean_float(generated_token_counts),
        "meanTokensPerSecond": mean_float(result.tokens_per_second for result in results),
    }
    if math.isfinite(completion_nll):
        metrics["completionNll"] = completion_nll
        metrics["completionPpl"] = safe_exp(completion_nll)
    metrics["pass"] = (
        metrics["jsonValidityRate"] >= 0.98
        and metrics["schemaPassRate"] == 1.0
        and metrics["safetyPassRate"] == 1.0
        and metrics["medicalDirectivePassRate"] == 1.0
        and metrics["phaseSixLinePassRate"] == 1.0
        and metrics["reflectionNextStepPassRate"] == 1.0
        and metrics["checkInTurnSequencePassRate"] == 1.0
    )
    return metrics


def grouped_eval_metrics(results: list[EvalResult], field_name: str) -> dict[str, Any]:
    groups: dict[str, list[EvalResult]] = {}
    for result in results:
        groups.setdefault(str(getattr(result, field_name)), []).append(result)
    return {key: compute_eval_metrics(group) for key, group in sorted(groups.items())}


def compare_eval_reports(base_report: dict[str, Any], lora_report: dict[str, Any]) -> dict[str, Any]:
    base_metrics = base_report["metrics"]
    lora_metrics = lora_report["metrics"]
    metric_deltas: dict[str, float] = {}
    for key, lora_value in lora_metrics.items():
        base_value = base_metrics.get(key)
        if (
            isinstance(lora_value, (int, float))
            and isinstance(base_value, (int, float))
            and not isinstance(lora_value, bool)
            and not isinstance(base_value, bool)
        ):
            metric_deltas[key] = float(lora_value) - float(base_value)
    base_nll = float(base_metrics.get("completionNll", float("nan")))
    lora_nll = float(lora_metrics.get("completionNll", float("nan")))
    if math.isfinite(base_nll) and base_nll > 0 and math.isfinite(lora_nll):
        nll_improvement_rate = (base_nll - lora_nll) / base_nll
    else:
        nll_improvement_rate = 0.0
    base_score = compute_wave_session_score(base_metrics, 0.0)
    lora_score = compute_wave_session_score(lora_metrics, nll_improvement_rate)
    return {
        "metricDeltas": metric_deltas,
        "completionNllImprovementRate": nll_improvement_rate,
        "pairedNllStats": paired_nll_stats(base_report["examples"], lora_report["examples"]),
        "breakdowns": compare_eval_breakdowns(
            base_report.get("breakdowns", {}),
            lora_report.get("breakdowns", {}),
        ),
        "baseWaveSessionScore": base_score,
        "loraWaveSessionScore": lora_score,
        "waveSessionScoreDelta": lora_score - base_score,
        "betterThanBase": lora_score > base_score,
        "scoreWeights": {
            "completionNllImprovement": 25,
            "jsonValidity": 10,
            "surfaceInvariants": 20,
            "safetyAndMedication": 20,
            "style": 15,
            "referenceSimilarity": 10,
        },
    }


def compare_completion_reports(base_report: dict[str, Any], lora_report: dict[str, Any]) -> dict[str, Any]:
    base_metrics = base_report["metrics"]
    lora_metrics = lora_report["metrics"]
    base_nll = float(base_metrics.get("completionNll", float("nan")))
    lora_nll = float(lora_metrics.get("completionNll", float("nan")))
    if math.isfinite(base_nll) and base_nll > 0 and math.isfinite(lora_nll):
        nll_improvement_rate = (base_nll - lora_nll) / base_nll
    else:
        nll_improvement_rate = 0.0
    return {
        "metricDeltas": {
            "completionNll": lora_nll - base_nll,
            "completionPpl": float(lora_metrics.get("completionPpl", float("nan")))
            - float(base_metrics.get("completionPpl", float("nan"))),
        },
        "completionNllImprovementRate": nll_improvement_rate,
        "pairedNllStats": paired_completion_nll_stats(base_report["examples"], lora_report["examples"]),
        "betterThanBase": lora_nll < base_nll,
    }


def paired_completion_nll_stats(
    base_examples: list[dict[str, Any]],
    lora_examples: list[dict[str, Any]],
) -> dict[str, Any]:
    base_by_id = {str(example["exampleId"]): example for example in base_examples}
    pairs: list[dict[str, Any]] = []
    for lora_example in lora_examples:
        example_id = str(lora_example["exampleId"])
        base_example = base_by_id.get(example_id)
        if base_example is None:
            continue
        base_nll = float(base_example.get("completionNll", float("nan")))
        lora_nll = float(lora_example.get("completionNll", float("nan")))
        if not math.isfinite(base_nll) or not math.isfinite(lora_nll):
            continue
        delta = base_nll - lora_nll
        pairs.append(
            {
                "exampleId": example_id,
                "surface": lora_example.get("surface"),
                "sourceLoraId": lora_example.get("sourceLoraId"),
                "sourceStatus": lora_example.get("sourceStatus"),
                "baseNll": base_nll,
                "loraNll": lora_nll,
                "nllDelta": delta,
                "loraWon": delta > 0,
            }
        )
    deltas = [pair["nllDelta"] for pair in pairs]
    wins = sum(1 for delta in deltas if delta > 0)
    losses = sum(1 for delta in deltas if delta < 0)
    ties = len(deltas) - wins - losses
    return {
        "pairCount": len(pairs),
        "wins": wins,
        "losses": losses,
        "ties": ties,
        "winRate": wins / len(pairs) if pairs else 0.0,
        "meanNllDelta": mean_float(deltas),
        "medianNllDelta": median_float(deltas),
        "meanNllDeltaBootstrap95Ci": bootstrap_mean_ci(deltas),
        "signTestPValue": sign_test_p_value(wins, losses),
        "examples": pairs,
    }


def paired_nll_stats(base_examples: list[dict[str, Any]], lora_examples: list[dict[str, Any]]) -> dict[str, Any]:
    base_by_id = {str(example["example_id"]): example for example in base_examples}
    pairs: list[dict[str, Any]] = []
    for lora_example in lora_examples:
        example_id = str(lora_example["example_id"])
        base_example = base_by_id.get(example_id)
        if base_example is None:
            continue
        if int(base_example.get("completion_token_count", 0)) <= 0 or int(
            lora_example.get("completion_token_count", 0)
        ) <= 0:
            continue
        base_nll = float(base_example.get("completion_nll", float("nan")))
        lora_nll = float(lora_example.get("completion_nll", float("nan")))
        if not math.isfinite(base_nll) or not math.isfinite(lora_nll):
            continue
        delta = base_nll - lora_nll
        pairs.append(
            {
                "exampleId": example_id,
                "surface": lora_example.get("surface"),
                "sourceLoraId": lora_example.get("source_lora_id"),
                "sourceStatus": lora_example.get("source_status"),
                "baseNll": base_nll,
                "loraNll": lora_nll,
                "nllDelta": delta,
                "loraWon": delta > 0,
            }
        )
    deltas = [pair["nllDelta"] for pair in pairs]
    wins = sum(1 for delta in deltas if delta > 0)
    losses = sum(1 for delta in deltas if delta < 0)
    ties = len(deltas) - wins - losses
    return {
        "pairCount": len(pairs),
        "wins": wins,
        "losses": losses,
        "ties": ties,
        "winRate": wins / len(pairs) if pairs else 0.0,
        "meanNllDelta": mean_float(deltas),
        "medianNllDelta": median_float(deltas),
        "meanNllDeltaBootstrap95Ci": bootstrap_mean_ci(deltas),
        "signTestPValue": sign_test_p_value(wins, losses),
        "examples": pairs,
    }


def compare_eval_breakdowns(base_breakdowns: dict[str, Any], lora_breakdowns: dict[str, Any]) -> dict[str, Any]:
    compared: dict[str, Any] = {}
    for group_name, lora_groups in lora_breakdowns.items():
        base_groups = base_breakdowns.get(group_name, {})
        group_comparisons: dict[str, Any] = {}
        for key, lora_metrics in lora_groups.items():
            base_metrics = base_groups.get(key)
            if isinstance(base_metrics, dict):
                group_comparisons[key] = compare_metric_summary(base_metrics, lora_metrics)
        compared[group_name] = group_comparisons
    return compared


def compare_metric_summary(base_metrics: dict[str, Any], lora_metrics: dict[str, Any]) -> dict[str, Any]:
    base_nll = float(base_metrics.get("completionNll", float("nan")))
    lora_nll = float(lora_metrics.get("completionNll", float("nan")))
    improvement = (base_nll - lora_nll) / base_nll if math.isfinite(base_nll) and base_nll > 0 else 0.0
    return {
        "exampleCount": lora_metrics.get("exampleCount", 0),
        "baseCompletionNll": base_nll,
        "loraCompletionNll": lora_nll,
        "completionNllImprovementRate": improvement,
        "baseWaveSessionScore": compute_wave_session_score(base_metrics, 0.0),
        "loraWaveSessionScore": compute_wave_session_score(lora_metrics, improvement),
        "jsonValidityDelta": float(lora_metrics.get("jsonValidityRate", 0.0))
        - float(base_metrics.get("jsonValidityRate", 0.0)),
        "schemaPassDelta": float(lora_metrics.get("schemaPassRate", 0.0))
        - float(base_metrics.get("schemaPassRate", 0.0)),
        "safetyPassDelta": float(lora_metrics.get("safetyPassRate", 0.0))
        - float(base_metrics.get("safetyPassRate", 0.0)),
        "tokenF1Delta": float(lora_metrics.get("meanTokenF1", 0.0))
        - float(base_metrics.get("meanTokenF1", 0.0)),
        "rougeLDelta": float(lora_metrics.get("meanRougeLF1", 0.0))
        - float(base_metrics.get("meanRougeLF1", 0.0)),
    }


def compute_wave_session_score(metrics: dict[str, Any], nll_improvement_rate: float) -> float:
    surface_invariants = (
        float(metrics.get("phaseSixLinePassRate", 0.0))
        + float(metrics.get("reflectionNextStepPassRate", 0.0))
        + float(metrics.get("checkInTurnSequencePassRate", 0.0))
    ) / 3
    safety_combo = (
        float(metrics.get("safetyPassRate", 0.0))
        + float(metrics.get("medicalDirectivePassRate", 0.0))
    ) / 2
    similarity = (
        float(metrics.get("meanTokenF1", 0.0)) + float(metrics.get("meanRougeLF1", 0.0))
    ) / 2
    score = (
        25.0 * clamp_float(nll_improvement_rate / 0.10, 0.0, 1.0)
        + 10.0 * float(metrics.get("jsonValidityRate", 0.0))
        + 20.0 * surface_invariants
        + 20.0 * safety_combo
        + 15.0 * float(metrics.get("stylePassRate", 0.0))
        + 10.0 * clamp_float(similarity, 0.0, 1.0)
    )
    return round(score, 2)


def mean_bool(values: Any) -> float:
    items = list(values)
    if not items:
        return 0.0
    return sum(1 for item in items if item) / len(items)


def mean_float(values: Any) -> float:
    items = list(values)
    if not items:
        return 0.0
    return sum(float(item) for item in items) / len(items)


def median_float(values: Any) -> float:
    items = sorted(float(item) for item in values)
    if not items:
        return 0.0
    middle = len(items) // 2
    if len(items) % 2 == 1:
        return items[middle]
    return (items[middle - 1] + items[middle]) / 2


def bootstrap_mean_ci(values: list[float], iterations: int = 1000, seed: int = 3407) -> dict[str, float]:
    if not values:
        return {"low": 0.0, "high": 0.0}
    rng = random.Random(seed)
    means: list[float] = []
    for _ in range(iterations):
        sample = [values[rng.randrange(len(values))] for _ in values]
        means.append(mean_float(sample))
    means.sort()
    return {
        "low": percentile(means, 0.025),
        "high": percentile(means, 0.975),
    }


def sign_test_p_value(wins: int, losses: int) -> float:
    trials = wins + losses
    if trials == 0:
        return 1.0
    smaller_side = min(wins, losses)
    probability = sum(math.comb(trials, k) for k in range(smaller_side + 1)) / (2**trials)
    return min(1.0, 2 * probability)


def weighted_mean(values: Any) -> float:
    items = [(float(value), int(weight)) for value, weight in values if int(weight) > 0]
    total_weight = sum(weight for _, weight in items)
    if total_weight == 0:
        return float("nan")
    return sum(value * weight for value, weight in items) / total_weight


def safe_exp(value: float) -> float:
    if not math.isfinite(value):
        return float("nan")
    return math.exp(min(value, 20.0))


def clamp_float(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def percentile(sorted_values: list[float], q: float) -> float:
    if not sorted_values:
        return 0.0
    if len(sorted_values) == 1:
        return sorted_values[0]
    position = (len(sorted_values) - 1) * q
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return sorted_values[lower]
    weight = position - lower
    return sorted_values[lower] * (1 - weight) + sorted_values[upper] * weight


def write_readme(path: Path, eval_report: dict[str, Any]) -> None:
    comparison = eval_report.get("comparison", {})
    base_report = eval_report.get("base")
    base = base_report["metrics"] if isinstance(base_report, dict) else None
    lora = eval_report["lora"]["metrics"]
    lines = [
        "# lora-wave-session Results",
        "",
        f"Generated: {eval_report['createdAt']}",
        "",
        "## Summary",
        "",
    ]
    if (
        base is not None
        and "completionNll" in base
        and "completionNll" in lora
        and "completionNllImprovementRate" in comparison
    ):
        lines.extend(
            [
                f"- Base completion NLL: {base['completionNll']:.4f}",
                f"- LoRA completion NLL: {lora['completionNll']:.4f}",
                f"- NLL improvement rate: {comparison['completionNllImprovementRate']:.2%}",
            ]
        )
    elif comparison.get("baseGenerationSkipped"):
        lines.append("- Base generation eval: skipped for speed. Use completion eval for base-vs-LoRA numeric proof.")
    if "meanLatencySeconds" in lora:
        lines.append(f"- Mean generation latency: {lora['meanLatencySeconds']:.2f}s")
    if "meanTokensPerSecond" in lora:
        lines.append(f"- Mean generation speed: {lora['meanTokensPerSecond']:.2f} tokens/s")
    if "baseWaveSessionScore" in comparison:
        lines.extend(
            [
                f"- Base WAVE session score: {comparison['baseWaveSessionScore']}",
                f"- LoRA WAVE session score: {comparison['loraWaveSessionScore']}",
                f"- Score delta: {comparison['waveSessionScoreDelta']}",
            ]
        )
    lines.extend(
        [
        "",
        "## Quality Gates",
        "",
    ])
    if "jsonValidityRate" in lora:
        lines.extend(
            [
                f"- JSON validity: {lora['jsonValidityRate']:.1%}",
                f"- Schema pass: {lora['schemaPassRate']:.1%}",
                f"- Safety pass: {lora['safetyPassRate']:.1%}",
                f"- Medication directive pass: {lora['medicalDirectivePassRate']:.1%}",
                f"- Phase six-line pass: {lora['phaseSixLinePassRate']:.1%}",
                f"- Reflection next-step pass: {lora['reflectionNextStepPassRate']:.1%}",
                f"- Check-in turn-sequence pass: {lora['checkInTurnSequencePassRate']:.1%}",
            ]
        )
    else:
        lines.append("- Generation quality gates were skipped for this completion-only eval run.")
    lines.extend(
        [
            "",
            "The full report is in `eval.json`; hyperparameter attempts are in `tuning-summary.json`.",
        ]
    )
    path.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    args = parse_args()
    output_dir = args.output_dir or default_output_dir()
    output_dir.mkdir(parents=True, exist_ok=True)

    examples = load_examples(args.data)
    train, validation, test = split_examples(
        examples,
        validation_size=args.validation_size,
        test_size=args.test_size,
        seed=args.seed,
    )
    shutil.copyfile(args.data, output_dir / "normalized.jsonl")
    write_jsonl(output_dir / "train.jsonl", train)
    write_jsonl(output_dir / "validation.jsonl", validation)
    write_jsonl(output_dir / "test.jsonl", test)
    write_run_config(output_dir / "run-config.json", args, examples, train, validation, test)

    print(
        f"Loaded {len(examples)} examples: "
        f"{len(train)} train / {len(validation)} validation / {len(test)} test"
    )
    print(f"Wrote split and config to {output_dir}")

    if args.dry_run:
        print("Dry run complete; skipping model load, training, and generation eval.")
        return

    train_and_eval(args, output_dir, train, validation, test)
    print(f"Saved adapter and eval artifacts under {output_dir}")


if __name__ == "__main__":
    main()
