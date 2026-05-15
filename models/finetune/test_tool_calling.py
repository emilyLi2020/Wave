"""Direct test: does our LoRA-merged Gemma 4 emit native tool tokens?

This bypasses every browser/wllama/llama.cpp/GGUF conversion layer. Loads the
merged-16bit HuggingFace checkpoint, applies the chat template with `tools=`
per Google's Gemma 4 function-calling docs, and prints the RAW model output
*with* special tokens preserved.

If the output contains `<|tool_call>...<tool_call|>` → the fine-tune kept
native tool emission and any downstream failure is a wllama/llama.cpp issue.

If the output is plain narration → PEFT training killed the capability and
we can stop chasing tool calling, period.

Usage (run from repo root):
  # Control run: base Gemma 4 only, no LoRA. Tells us if tool emission
  # works at all in the base model on this transformers version.
  uv run --project models python models/finetune/test_tool_calling.py

  # Fine-tune run: base + our LoRA adapter. Tells us if PEFT retained
  # the capability.
  uv run --project models python models/finetune/test_tool_calling.py \\
      --adapter Maelstrome/lora-wave-session-r32
"""

from __future__ import annotations

import argparse
import json
import sys


# A check-in history that ends with a clear patient affirmative — by our
# prompt's protocol, the model should respond with a brief warm hand-off
# AND call the endConversation tool in the same response.
READY_HISTORY = [
    {"role": "user", "content": "About a 6."},
    {
        "role": "assistant",
        "content": (
            "Six is a little lower than where you started. Where did you "
            "notice the urge most during the last chunk?"
        ),
    },
    {"role": "user", "content": "Mostly in my chest."},
    {
        "role": "assistant",
        "content": (
            "Chest is useful information. Try noticing the edges of that "
            "pressure for one breath, without pushing it away. What changes?"
        ),
    },
    {"role": "user", "content": "It softened a little."},
    {
        "role": "assistant",
        "content": (
            "Softening a little is worth noticing — you stayed with the urge. "
            "Ready to continue with the sound anchor?"
        ),
    },
    {"role": "user", "content": "Yes, ready."},
]

# Same endConversation tool defn we ship in the schema-probe / production
# wllama path, in the OpenAI function-tool format that
# `processor.apply_chat_template(..., tools=...)` accepts for Gemma 4.
END_CONVERSATION_TOOL = {
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


SYSTEM_PROMPT = (
    "You are a WAVE clinical check-in agent running between meditation chunks. "
    "Reflect, ask one concrete question at a time, and keep replies to 1-3 "
    "short sentences. When the patient has clearly signalled readiness to "
    "continue, call the endConversation tool — and pair it with a warm 1-2 "
    "sentence closing hand-off in the same response."
)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source-repo",
        type=str,
        default="unsloth/gemma-4-E2B-it",
        help=(
            "HF repo id of the base model. Default: unsloth/gemma-4-E2B-it "
            "(matches our LoRA base). Pass --adapter to apply a LoRA on "
            "top of this."
        ),
    )
    parser.add_argument(
        "--adapter",
        type=str,
        default=None,
        help=(
            "Optional HF repo id of a LoRA adapter to apply on top of "
            "--source-repo via PEFT. Use Maelstrome/lora-wave-session-r32 "
            "to test our fine-tune."
        ),
    )
    parser.add_argument("--max-new-tokens", type=int, default=200)
    parser.add_argument(
        "--device",
        type=str,
        default="auto",
        help="device_map for from_pretrained (default: auto).",
    )
    args = parser.parse_args()

    label = args.source_repo + (f" + LoRA[{args.adapter}]" if args.adapter else " (no LoRA — control run)")
    print(f"=== Tool-calling probe for {label} ===\n", flush=True)

    # Lazy imports so --help works without torch installed.
    import torch
    from transformers import AutoModelForCausalLM, AutoProcessor, AutoTokenizer

    print(
        "Loading model + processor (this can take a minute on first run)…",
        flush=True,
    )

    # Try AutoProcessor first (Gemma 4 multimodal-aware); fall back to
    # tokenizer-only if the repo doesn't have processor artifacts.
    try:
        processor = AutoProcessor.from_pretrained(args.source_repo)
        tokenizer = processor.tokenizer
        use_processor = True
        print(f"Loaded AutoProcessor ({type(processor).__name__})", flush=True)
    except Exception as err:  # noqa: BLE001
        print(f"AutoProcessor failed ({err}); falling back to tokenizer.", flush=True)
        tokenizer = AutoTokenizer.from_pretrained(args.source_repo)
        processor = None
        use_processor = False

    model = AutoModelForCausalLM.from_pretrained(
        args.source_repo,
        torch_dtype=torch.bfloat16,
        device_map=args.device,
    )

    if args.adapter:
        from peft import PeftModel

        print(f"\nApplying LoRA adapter: {args.adapter}", flush=True)
        model = PeftModel.from_pretrained(model, args.adapter)
        # Merge so generation goes through the merged weights — avoids
        # PEFT's slow adapter-injection path and matches what the GGUF
        # ships.
        model = model.merge_and_unload()
        print("Adapter merged.", flush=True)

    model.eval()

    print("\n--- Chat template (truncated to 400 chars) ---", flush=True)
    template = tokenizer.chat_template or "(none baked into tokenizer)"
    print(template[:400] + ("..." if len(template) > 400 else ""), flush=True)

    # Build the messages the same way the wllama path does (system message
    # carries our prompt; the contextBlock is folded into the first user
    # turn so Gemma's chat template doesn't trip on doubled user messages).
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        *READY_HISTORY,
    ]

    # The KEY call: apply_chat_template with tools=. This is the path
    # Google's Gemma 4 docs document — the chat template knows how to
    # render the tools spec inline and instruct the model in its native
    # tool-call format.
    apply = (
        processor.apply_chat_template if use_processor else tokenizer.apply_chat_template
    )
    try:
        prompt_text = apply(
            messages,
            tools=[END_CONVERSATION_TOOL],
            add_generation_prompt=True,
            tokenize=False,
        )
    except TypeError as err:
        print(
            f"\n!! apply_chat_template does NOT accept tools= ({err}).\n"
            "   Falling back to a no-tools render. This is itself a strong\n"
            "   signal — Gemma 4's chat template may need a newer transformers.\n",
            flush=True,
        )
        prompt_text = apply(
            messages, add_generation_prompt=True, tokenize=False
        )

    print("\n--- Rendered prompt (last 500 chars) ---", flush=True)
    print(prompt_text[-500:], flush=True)
    print("--- end prompt ---\n", flush=True)

    # Tokenize + generate.
    inputs = tokenizer(prompt_text, return_tensors="pt").to(model.device)
    with torch.inference_mode():
        outputs = model.generate(
            **inputs,
            max_new_tokens=args.max_new_tokens,
            do_sample=False,
            temperature=None,
            top_p=None,
        )
    new_tokens = outputs[0, inputs.input_ids.shape[1] :]

    # Decode TWO ways:
    #   1. With special tokens preserved — shows raw native tokens
    #      including any <|tool_call>/<tool_call|> the model emitted.
    #   2. With special tokens stripped — shows what the user would see.
    raw = tokenizer.decode(new_tokens, skip_special_tokens=False)
    clean = tokenizer.decode(new_tokens, skip_special_tokens=True)

    print("\n=== RAW OUTPUT (special tokens preserved) ===\n", flush=True)
    print(raw, flush=True)
    print("\n=== CLEAN OUTPUT (special tokens stripped) ===\n", flush=True)
    print(clean, flush=True)

    # Per-token dump for the tool-call hunt.
    individual = [tokenizer.decode([tid], skip_special_tokens=False) for tid in new_tokens.tolist()]
    print("\n=== TOKEN BY TOKEN ===\n", flush=True)
    for i, tok in enumerate(individual):
        print(f"  {i:3d}: {json.dumps(tok)}", flush=True)

    # Verdict.
    tool_tokens = [
        t for t in individual if t in ("<|tool_call>", "<tool_call|>", "<|tool_response>", "<tool_response|>")
    ]
    contains_substr = "<|tool_call>" in raw

    print("\n=== VERDICT ===", flush=True)
    if tool_tokens:
        print(
            f"PASS — fine-tune emits Gemma 4 native tool tokens: "
            f"{tool_tokens}. Tool calling IS retained at the model level. "
            f"Downstream failures (wllama, llama.cpp) are infrastructure bugs.",
            flush=True,
        )
        sys.exit(0)
    if contains_substr:
        print(
            "PARTIAL — '<|tool_call>' appears as a substring but not as a "
            "discrete vocab token. PEFT remapped the special tokens; model "
            "literally types the characters. Hacky parser still possible.",
            flush=True,
        )
        sys.exit(0)
    print(
        "FAIL — pure narration, no tool tokens of any kind. PEFT training "
        "killed native tool emission. No infrastructure change can recover "
        "this; stay on JSON-schema for structured signals.",
        flush=True,
    )
    sys.exit(1)


if __name__ == "__main__":
    main()
