"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";

import type { ClientLoraFormSpec } from "@/lib/training/client-spec";
import type {
  ConstFieldSpec,
  FieldSpec,
  SeedStatus,
  TrainingSeed,
} from "@/lib/training/types";
import { SEED_STATUSES } from "@/lib/training/types";

type Json = Record<string, unknown>;

interface Props {
  spec: ClientLoraFormSpec;
  /** Existing seed when editing; null when creating. */
  existing: TrainingSeed | null;
}

interface DraftSnapshot {
  input: Json;
  output: Json;
  authorInitials: string;
  notes: string;
  status: SeedStatus;
  savedAt: number;
}

function defaultsFor(fields: readonly FieldSpec[]): Json {
  const out: Json = {};
  for (const field of fields) {
    switch (field.kind) {
      case "text":
        out[field.key] = "";
        break;
      case "text-array":
        out[field.key] = Array.from({ length: field.maxItems }, () => "");
        break;
      case "number":
        out[field.key] = "";
        break;
      case "enum":
        out[field.key] = field.optional ? "" : field.options[0] ?? "";
        break;
      case "boolean":
        out[field.key] = false;
        break;
      case "const":
        out[field.key] = field.value;
        break;
      case "object":
        out[field.key] = defaultsFor(field.fields);
        break;
    }
  }
  return out;
}

/**
 * Coerce form-state strings into the shape the API expects:
 *   - number fields: "" → undefined (or 0 if non-optional), else parseFloat
 *   - enum optional with "" → undefined
 *   - text optional with "" → undefined
 */
function coerce(fields: readonly FieldSpec[], state: Json): Json {
  const out: Json = {};
  for (const field of fields) {
    const raw = state[field.key];
    switch (field.kind) {
      case "text": {
        const value = typeof raw === "string" ? raw : "";
        if (field.optional && value.trim() === "") break;
        out[field.key] = value;
        break;
      }
      case "text-array": {
        const rawItems = Array.isArray(raw) ? raw : [];
        const items = rawItems
          .slice(0, field.maxItems)
          .map((item) => (typeof item === "string" ? item : ""));
        while (items.length < field.minItems) {
          items.push("");
        }
        out[field.key] = items;
        break;
      }
      case "number": {
        if (raw === "" || raw === null || raw === undefined) {
          if (field.optional) break;
          out[field.key] = field.min;
          break;
        }
        const parsed =
          typeof raw === "number" ? raw : Number.parseFloat(String(raw));
        out[field.key] = Number.isFinite(parsed) ? parsed : raw;
        break;
      }
      case "enum": {
        if (raw === "" || raw === undefined) {
          if (field.optional) break;
          out[field.key] = field.options[0] ?? "";
          break;
        }
        // Special-case the body-scan breathCount enum: stored as numeric
        // literal in the schema but rendered as a string-option enum.
        if (field.key === "breathCount" && typeof raw === "string") {
          const n = Number.parseInt(raw, 10);
          out[field.key] = Number.isFinite(n) ? n : raw;
          break;
        }
        out[field.key] = raw;
        break;
      }
      case "boolean": {
        out[field.key] = Boolean(raw);
        break;
      }
      case "const": {
        out[field.key] = field.value;
        break;
      }
      case "object": {
        out[field.key] = coerce(
          field.fields,
          (raw as Json) ?? defaultsFor(field.fields),
        );
        break;
      }
    }
  }
  return out;
}

function rehydrateForState(
  fields: readonly FieldSpec[],
  payload: Json | undefined,
): Json {
  const defaults = defaultsFor(fields);
  if (!payload) return defaults;
  const merged: Json = { ...defaults };
  for (const field of fields) {
    const value = payload[field.key];
    switch (field.kind) {
      case "text":
        merged[field.key] = typeof value === "string" ? value : "";
        break;
      case "text-array": {
        const rawItems = Array.isArray(value) ? value : [];
        const items = Array.from({ length: field.maxItems }, (_, index) => {
          const item = rawItems[index];
          return typeof item === "string" ? item : "";
        });
        merged[field.key] = items;
        break;
      }
      case "number":
        merged[field.key] =
          value === undefined || value === null ? "" : String(value);
        break;
      case "enum":
        if (field.key === "breathCount" && typeof value === "number") {
          merged[field.key] = String(value);
        } else if (typeof value === "string") {
          merged[field.key] = value;
        }
        break;
      case "boolean":
        merged[field.key] = Boolean(value);
        break;
      case "const":
        merged[field.key] = field.value;
        break;
      case "object":
        merged[field.key] = rehydrateForState(field.fields, value as Json);
        break;
    }
  }
  return merged;
}

export function SeedForm({ spec, existing }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const draftKey = useMemo(
    () => `wave-training-draft:${spec.loraId}:${existing?.id ?? "new"}`,
    [spec.loraId, existing?.id],
  );
  const lastInputKey = useMemo(
    () => `wave-training-last-input:${spec.loraId}`,
    [spec.loraId],
  );

  const initialInput = useMemo(
    () => rehydrateForState(spec.inputFields, existing?.input as Json),
    [spec.inputFields, existing?.input],
  );
  const initialOutput = useMemo(
    () => rehydrateForState(spec.outputFields, existing?.output as Json),
    [spec.outputFields, existing?.output],
  );

  const [inputState, setInputState] = useState<Json>(initialInput);
  const [outputState, setOutputState] = useState<Json>(initialOutput);
  const [authorInitials, setAuthorInitials] = useState<string>(
    existing?.authorInitials ?? "",
  );
  const [notes, setNotes] = useState<string>(existing?.notes ?? "");
  const [status, setStatus] = useState<SeedStatus>(existing?.status ?? "draft");
  const [restoredAt, setRestoredAt] = useState<number | null>(null);

  // Restore from localStorage on first mount. Drafts win over the last
  // completed input so an unfinished example is never overwritten.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(draftKey);
      if (!raw) {
        if (!existing) {
          const lastInput = window.localStorage.getItem(lastInputKey);
          if (lastInput) {
            const payload = JSON.parse(lastInput) as Json;
            setInputState(rehydrateForState(spec.inputFields, payload));
          }
        }
        return;
      }
      const draft = JSON.parse(raw) as DraftSnapshot;
      setInputState(rehydrateForState(spec.inputFields, draft.input));
      setOutputState(rehydrateForState(spec.outputFields, draft.output));
      setAuthorInitials(draft.authorInitials ?? "");
      setNotes(draft.notes ?? "");
      setStatus(draft.status ?? "draft");
      setRestoredAt(draft.savedAt);
    } catch {
      // ignore malformed drafts
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, lastInputKey, existing]);

  // Persist on every change.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const snapshot: DraftSnapshot = {
      input: inputState,
      output: outputState,
      authorInitials,
      notes,
      status,
      savedAt: Date.now(),
    };
    try {
      window.localStorage.setItem(draftKey, JSON.stringify(snapshot));
    } catch {
      // localStorage may be full or disabled; ignore.
    }
  }, [inputState, outputState, authorInitials, notes, status, draftKey]);

  function update(side: "input" | "output", path: string[], value: unknown) {
    const setter = side === "input" ? setInputState : setOutputState;
    setter((prev) => {
      const next: Json = JSON.parse(JSON.stringify(prev)) as Json;
      let cursor: Json = next;
      for (let i = 0; i < path.length - 1; i += 1) {
        const segment = path[i];
        const nested = cursor[segment];
        if (typeof nested !== "object" || nested === null) {
          cursor[segment] = {};
        }
        cursor = cursor[segment] as Json;
      }
      cursor[path[path.length - 1]] = value;
      return next;
    });
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setServerError(null);

    const coercedInput = coerce(spec.inputFields, inputState);
    const body = {
      loraId: spec.loraId,
      input: coercedInput,
      output: coerce(spec.outputFields, outputState),
      authorInitials: authorInitials.trim() || null,
      notes: notes.trim() || null,
      status,
    };

    try {
      const url = existing
        ? `/api/training/seeds/${existing.id}`
        : "/api/training/seeds";
      const method = existing ? "PATCH" : "POST";
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
          issues?: { path: (string | number)[]; message: string }[];
        };
        const issuesText = payload.issues
          ?.map(
            (i) => `${i.path.join(".") || "(root)"}: ${i.message}`,
          )
          .join(" · ");
        setServerError(
          payload.message ||
            issuesText ||
            payload.error ||
            "Save failed. Please try again.",
        );
        setSubmitting(false);
        return;
      }
      // Success — clear the local draft and refresh.
      try {
        window.localStorage.removeItem(draftKey);
        window.localStorage.setItem(lastInputKey, JSON.stringify(coercedInput));
      } catch {
        // ignore
      }
      startTransition(() => {
        router.push(`/training/${spec.loraId}`);
        router.refresh();
      });
    } catch (err) {
      setServerError((err as Error).message);
      setSubmitting(false);
    }
  }

  const busy = submitting || isPending;

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {restoredAt ? (
        <div className="rounded-xl border border-accent/30 bg-accent-soft/30 px-4 py-3 text-xs text-foreground/70">
          Restored a draft you saved on{" "}
          {new Date(restoredAt).toLocaleString()}. Submit to clear it, or{" "}
          <button
            type="button"
            className="underline hover:text-accent"
            onClick={() => {
              try {
                window.localStorage.removeItem(draftKey);
              } catch {
                // ignore
              }
              setInputState(initialInput);
              setOutputState(initialOutput);
              setAuthorInitials(existing?.authorInitials ?? "");
              setNotes(existing?.notes ?? "");
              setStatus(existing?.status ?? "draft");
              setRestoredAt(null);
            }}
          >
            discard the draft
          </button>
          .
        </div>
      ) : null}

      <div className="grid gap-6">
        <FieldSection
          title="Patient context (input)"
          description="What WAVE is reading when it generates this response."
          fields={spec.inputFields}
          state={inputState}
          path={[]}
          side="input"
          onChange={update}
        />
        <FieldSection
          title="Response WAVE should produce (output)"
          description="The exact JSON shape the LoRA must emit."
          fields={spec.outputFields}
          state={outputState}
          path={[]}
          side="output"
          onChange={update}
        />
      </div>

      <div className="rounded-2xl border border-border bg-surface p-5 grid gap-4 sm:grid-cols-3">
        <label className="text-sm">
          <span className="font-medium">Author initials</span>
          <input
            type="text"
            value={authorInitials}
            onChange={(e) => setAuthorInitials(e.target.value)}
            maxLength={6}
            placeholder="e.g. RM"
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-accent"
          />
        </label>
        <label className="text-sm sm:col-span-2">
          <span className="font-medium">Notes (clinician-only)</span>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={2000}
            placeholder="What you were thinking when you wrote this. Not used for training."
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-accent"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-surface p-5">
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium">Status</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as SeedStatus)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-accent"
          >
            {SEED_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <p className="text-xs text-foreground/55 max-w-md">
            Drafts skip schema validation. Promote to <em>ready</em> when
            you&apos;re happy with it; the server will check it against
            the LoRA&apos;s invariants on save.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <a
            href={`/training/${spec.loraId}`}
            className="text-sm text-foreground/60 hover:text-accent"
          >
            Cancel
          </a>
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-accent-foreground hover:opacity-90 transition disabled:opacity-50"
          >
            {busy ? "Saving…" : existing ? "Save changes" : "Save example"}
          </button>
        </div>
      </div>

      {serverError ? (
        <div
          role="alert"
          className="rounded-xl border border-danger/40 bg-danger-soft/40 px-4 py-3 text-sm text-danger"
        >
          {serverError}
        </div>
      ) : null}
    </form>
  );
}

interface FieldSectionProps {
  title: string;
  description: string;
  fields: readonly FieldSpec[];
  state: Json;
  path: string[];
  side: "input" | "output";
  onChange: (side: "input" | "output", path: string[], value: unknown) => void;
}

function FieldSection({
  title,
  description,
  fields,
  state,
  path,
  side,
  onChange,
}: FieldSectionProps) {
  return (
    <fieldset className="min-w-0 rounded-2xl border border-border bg-surface p-5 space-y-4">
      <legend className="px-1 text-xs uppercase tracking-wide text-foreground/55">
        {title}
      </legend>
      <p className="text-xs text-foreground/55 -mt-2">{description}</p>
      {fields.map((field) => (
        <FieldRenderer
          key={field.key}
          field={field}
          state={state}
          path={path}
          side={side}
          onChange={onChange}
        />
      ))}
    </fieldset>
  );
}

interface FieldRendererProps {
  field: FieldSpec;
  state: Json;
  path: string[];
  side: "input" | "output";
  onChange: (side: "input" | "output", path: string[], value: unknown) => void;
}

function FieldRenderer({
  field,
  state,
  path,
  side,
  onChange,
}: FieldRendererProps) {
  const value = state[field.key];
  const fullPath = [...path, field.key];
  const id = `${side}-${fullPath.join("-")}`;

  switch (field.kind) {
    case "text":
      return (
        <FieldShell field={field} id={id}>
          {field.multiline ? (
            <textarea
              id={id}
              value={typeof value === "string" ? value : ""}
              onChange={(e) => onChange(side, fullPath, e.target.value)}
              rows={4}
              maxLength={field.maxLength}
              minLength={field.minLength}
              placeholder={field.placeholder}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm leading-relaxed focus:outline-none focus:border-accent"
            />
          ) : (
            <input
              id={id}
              type="text"
              value={typeof value === "string" ? value : ""}
              onChange={(e) => onChange(side, fullPath, e.target.value)}
              maxLength={field.maxLength}
              minLength={field.minLength}
              placeholder={field.placeholder}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-accent"
            />
          )}
          {field.maxLength ? (
            <p className="mt-1 text-xs text-foreground/45 text-right">
              {(typeof value === "string" ? value.length : 0)}/
              {field.maxLength}
            </p>
          ) : null}
        </FieldShell>
      );
    case "text-array": {
      const items = Array.isArray(value) ? value : [];
      return (
        <FieldShell field={field} id={id}>
          <div className="space-y-3">
            {Array.from({ length: field.maxItems }, (_, index) => {
              const itemId = `${id}-${index}`;
              const itemValue = items[index];
              return (
                <div key={itemId}>
                  <label
                    htmlFor={itemId}
                    className="block text-xs font-medium text-foreground/60"
                  >
                    {field.itemLabel} {index + 1}
                  </label>
                  <textarea
                    id={itemId}
                    value={typeof itemValue === "string" ? itemValue : ""}
                    onChange={(event) => {
                      const next = Array.from(
                        { length: field.maxItems },
                        (_, itemIndex) =>
                          typeof items[itemIndex] === "string"
                            ? items[itemIndex]
                            : "",
                      );
                      next[index] = event.target.value;
                      onChange(side, fullPath, next);
                    }}
                    rows={2}
                    maxLength={field.maxLength}
                    minLength={field.minLength}
                    placeholder={field.placeholder}
                    className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm leading-relaxed focus:outline-none focus:border-accent"
                  />
                  {field.maxLength ? (
                    <p className="mt-1 text-xs text-foreground/45 text-right">
                      {(typeof itemValue === "string" ? itemValue.length : 0)}/
                      {field.maxLength}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </FieldShell>
      );
    }
    case "number":
      return (
        <FieldShell field={field} id={id}>
          <input
            id={id}
            type="number"
            value={typeof value === "string" || typeof value === "number" ? value : ""}
            onChange={(e) => onChange(side, fullPath, e.target.value)}
            min={field.min}
            max={field.max}
            step={field.step ?? (field.integer ? 1 : "any")}
            placeholder={field.placeholder}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-accent"
          />
        </FieldShell>
      );
    case "enum":
      return (
        <FieldShell field={field} id={id}>
          <select
            id={id}
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(side, fullPath, e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-accent"
          >
            {field.optional ? <option value="">— blank —</option> : null}
            {field.options.map((opt) => (
              <option key={opt} value={opt}>
                {field.optionLabels?.[opt] ?? opt}
              </option>
            ))}
          </select>
        </FieldShell>
      );
    case "boolean":
      return (
        <FieldShell field={field} id={id}>
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              id={id}
              type="checkbox"
              checked={Boolean(value)}
              onChange={(e) => onChange(side, fullPath, e.target.checked)}
              className="h-4 w-4 rounded border-border accent-accent"
            />
            <span className="text-foreground/70">
              {Boolean(value) ? "true" : "false"}
            </span>
          </label>
        </FieldShell>
      );
    case "const":
      return <ConstFieldDisplay field={field} id={id} />;
    case "object":
      return (
        <FieldShell field={field} id={id}>
          <div className="rounded-lg border border-dashed border-border bg-surface-muted/40 p-3 space-y-3">
            {field.fields.map((sub) => (
              <FieldRenderer
                key={sub.key}
                field={sub}
                state={(value as Json) ?? {}}
                path={fullPath}
                side={side}
                onChange={onChange}
              />
            ))}
          </div>
        </FieldShell>
      );
  }
}

function FieldShell({
  field,
  id,
  children,
}: {
  field: Exclude<FieldSpec, ConstFieldSpec>;
  id: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium">
        {field.label}{" "}
        {field.optional ? (
          <span className="text-xs font-normal text-foreground/45">
            (optional)
          </span>
        ) : null}
      </label>
      {field.help ? (
        <p className="mt-0.5 text-xs text-foreground/55">{field.help}</p>
      ) : null}
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function ConstFieldDisplay({
  field,
  id,
}: {
  field: ConstFieldSpec;
  id: string;
}) {
  return (
    <div>
      <span id={id} className="block text-sm font-medium">
        {field.label}
      </span>
      <p className="mt-0.5 text-xs text-foreground/55">
        {field.help ?? "Fixed by the LoRA contract — not editable."}
      </p>
      <div className="mt-1.5 inline-flex items-center gap-2 rounded-full border border-border bg-surface-muted px-3 py-1.5 text-xs font-mono">
        {String(field.value)}
      </div>
    </div>
  );
}
