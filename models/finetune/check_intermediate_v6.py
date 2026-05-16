"""Inspect intermediate check_in rows in v6 dataset.

Validates the mode-collapse hypothesis: does the LoRA's collapsed output
'Ready to continue into the body scan?' actually appear as a TARGET reply
across many intermediate rows? Or only in the user prompt's clinician
instructions?
"""

import json
from collections import Counter

PATH = "/workspace/wave/models/datasets/lora-wave-session-toolcall-v6.jsonl"
NEEDLE = "Ready to continue into the body scan?"


def main() -> None:
    rows = []
    with open(PATH) as f:
        for line in f:
            rows.append(json.loads(line))

    inter = [
        r for r in rows
        if r["input"]["surface"] == "check_in"
        and not r["output"].get("endConversation")
    ]
    # Dedupe by id
    seen = set()
    inter_u = []
    for r in inter:
        if r["id"] not in seen:
            seen.add(r["id"])
            inter_u.append(r)

    print("intermediate check_in unique:", len(inter_u))

    targets = Counter(r["messages"][-1]["content"] for r in inter_u)
    print()
    print("=== Top 10 most-repeated INTERMEDIATE assistant targets ===")
    for t, c in targets.most_common(10):
        preview = t[:140].replace("\n", " ")
        print("  x{0}  {1!r}".format(c, preview))

    exact = sum(1 for r in inter_u if r["messages"][-1]["content"].strip() == NEEDLE)
    contains = sum(1 for r in inter_u if NEEDLE in r["messages"][-1]["content"])
    prompt_has = sum(1 for r in inter_u if NEEDLE in r["messages"][1]["content"])
    print()
    print("intermediate TARGET IS exactly the needle :", exact)
    print("intermediate TARGET CONTAINS the needle   :", contains)
    print("intermediate USER PROMPT contains needle  :", prompt_has)

    print()
    print("=== 3 example intermediate rows where TARGET contains the readiness Q ===")
    matches = [r for r in inter_u if NEEDLE in r["messages"][-1]["content"]][:3]
    for i, r in enumerate(matches):
        rid = r["id"]
        print("\n--- intermediate row %d  id=%s ---" % (i, rid))
        print("ASSISTANT TARGET (%d chars):" % len(r["messages"][-1]["content"]))
        print(r["messages"][-1]["content"])

    print()
    print("=== Histogram: first 60 chars of intermediate targets, top 15 ===")
    starts = Counter(r["messages"][-1]["content"][:60] for r in inter_u)
    for s, c in starts.most_common(15):
        print("  x{0:>3}  {1!r}".format(c, s))


if __name__ == "__main__":
    main()
