"use client";

/**
 * @deprecated Legacy body-region tap diagram used at intake by the
 * old session machine. The five-chunk session does not collect a body
 * region up front — the body scan happens inside Chunk 2 as a guided
 * observation. Slated for removal in a follow-up cleanup PR. Do not
 * import from here in new code.
 */

import type { BodyScanLocation } from "@/types/models";

const REGIONS: { value: BodyScanLocation; label: string; hint: string }[] = [
  { value: "jaw", label: "Jaw", hint: "clench / grind" },
  { value: "shoulders", label: "Shoulders", hint: "weight / hold" },
  { value: "chest", label: "Chest", hint: "tightness / breath" },
  { value: "stomach", label: "Stomach", hint: "flutter / hollow" },
  { value: "legs", label: "Legs", hint: "restless / want to move" },
  { value: "other", label: "Other", hint: "somewhere else" },
];

interface Props {
  selected: BodyScanLocation | null;
  onSelect: (region: BodyScanLocation) => void;
}

export function BodyScanDiagram({ selected, onSelect }: Props) {
  return (
    <div className="rounded-xl border border-border bg-surface-muted p-4">
      <p className="text-sm text-foreground/70">
        Where in your body does the craving sit right now?
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {REGIONS.map((region) => (
          <button
            key={region.value}
            type="button"
            onClick={() => onSelect(region.value)}
            aria-pressed={selected === region.value}
            className={`text-left rounded-xl border px-3 py-3 text-sm transition ${
              selected === region.value
                ? "border-accent bg-accent text-accent-foreground"
                : "border-border bg-surface hover:border-accent hover:text-accent"
            }`}
          >
            <span className="block font-medium">{region.label}</span>
            <span
              className={`block text-[11px] ${
                selected === region.value
                  ? "text-accent-foreground/80"
                  : "text-foreground/60"
              }`}
            >
              {region.hint}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
