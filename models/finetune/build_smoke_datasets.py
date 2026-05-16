"""Build two smoke training datasets from lora-wave-session-toolcall-v4.jsonl.

Dataset A — one ending check_in row, duplicated to 12 rows. Tests whether ANY
gradient step destroys tool emission. With batch=1 GA=8, 12 rows yields ~1
step per epoch.

Dataset B — three rows of each surface (intermediate check_in, ending
check_in, phase_narration, reflection) = 12 rows total. Tests whether
training across the full multi-surface mix at tiny scale preserves tool
emission AND non-tool capabilities.

Both target the trainer's `len(examples) >= 10` minimum split guard.
"""

from __future__ import annotations

import json
import random
from collections import defaultdict
from pathlib import Path

V4_PATH = Path("datasets/lora-wave-session-toolcall-v4.jsonl")
A_OUT = Path("datasets/lora-wave-session-toolcall-v4-smokeA.jsonl")
B_OUT = Path("datasets/lora-wave-session-toolcall-v4-smokeB.jsonl")

# Group v4 rows by surface (and by whether check_in is ending vs intermediate)
buckets: dict[str, list[dict]] = defaultdict(list)
seen_ids: set[str] = set()
with V4_PATH.open("r", encoding="utf-8") as f:
    for line in f:
        row = json.loads(line)
        # v4 ending rows are 3x-duplicated; dedupe by id for the smoke pool.
        rid = row["id"]
        if rid in seen_ids:
            continue
        seen_ids.add(rid)
        surface = row["input"]["surface"]
        if surface == "check_in":
            kind = "check_in_ending" if row["output"].get("endConversation") else "check_in_intermediate"
        else:
            kind = surface
        buckets[kind].append(row)

print("Unique rows per bucket in v4:")
for k, rows in buckets.items():
    print(f"  {k:<24}: {len(rows)}")
print()

rng = random.Random(7)

# Dataset A: 1 unique ending row, duplicated 12 times
ending_pool = buckets["check_in_ending"]
assert ending_pool, "no ending check_in rows in v4 dataset"
chosen = ending_pool[0]  # deterministic: first ending row
a_rows = [chosen] * 12

# Dataset B: 3 each of 4 surfaces
b_rows: list[dict] = []
for kind in ("check_in_ending", "check_in_intermediate", "phase_narration", "reflection"):
    pool = buckets[kind]
    assert len(pool) >= 3, f"need >= 3 rows for {kind}, got {len(pool)}"
    b_rows.extend(pool[:3])
rng.shuffle(b_rows)

V4_PATH.parent.mkdir(parents=True, exist_ok=True)
with A_OUT.open("w", encoding="utf-8") as f:
    for row in a_rows:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")
with B_OUT.open("w", encoding="utf-8") as f:
    for row in b_rows:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")

print(f"Wrote smoke dataset A: {A_OUT.resolve()} ({len(a_rows)} rows, 1 unique)")
print(f"Wrote smoke dataset B: {B_OUT.resolve()} ({len(b_rows)} rows, 12 unique across 4 surfaces)")
print()
print(f"Smoke A surfaces: 12x ending check_in (id={chosen['id']})")
print(f"Smoke B surfaces: 3 ending check_in, 3 intermediate check_in, 3 phase, 3 reflection")
