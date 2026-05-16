"""Inspect ENDING check_in rows: do any have 'Ready to continue into the body scan?' in the closing speech?"""

import json
from collections import Counter

PATH = "/workspace/wave/models/datasets/lora-wave-session-toolcall-v6.jsonl"
NEEDLE = "Ready to continue into the body scan?"


def main() -> None:
    rows = []
    with open(PATH) as f:
        for line in f:
            rows.append(json.loads(line))

    end = [
        r for r in rows
        if r["input"]["surface"] == "check_in"
        and r["output"].get("endConversation")
    ]
    seen = set()
    end_u = []
    for r in end:
        if r["id"] not in seen:
            seen.add(r["id"])
            end_u.append(r)

    print("ENDING check_in unique:", len(end_u))

    # Ending assistant content has shape:
    #   "endConversation{...}\n<closing speech>"
    # The needle could be in the closing speech.
    closings = []
    for r in end_u:
        content = r["messages"][-1]["content"]
        parts = content.split("\n", 1)
        closing = parts[1] if len(parts) == 2 else content
        closings.append(closing)

    exact = sum(1 for c in closings if c.strip() == NEEDLE)
    contains = sum(1 for c in closings if NEEDLE in c)
    print()
    print("ending closing speech IS exactly needle :", exact)
    print("ending closing speech CONTAINS needle   :", contains)

    print()
    print("=== Top 10 most-repeated ENDING closing speeches ===")
    cs_counts = Counter(closings)
    for s, c in cs_counts.most_common(10):
        print("  x{0:>3}  {1!r}".format(c, s[:150]))

    print()
    print("=== Top 10 most-repeated FIRST 50 chars of closing speech ===")
    starts = Counter(c[:50] for c in closings)
    for s, c in starts.most_common(10):
        print("  x{0:>3}  {1!r}".format(c, s))

    # Also: top 10 first-50-char of FULL assistant target (includes tool call line)
    print()
    print("=== Top 10 first 100 chars of FULL ending assistant target ===")
    fulls = Counter(r["messages"][-1]["content"][:100] for r in end_u)
    for s, c in fulls.most_common(10):
        print("  x{0:>3}  {1!r}".format(c, s))


if __name__ == "__main__":
    main()
