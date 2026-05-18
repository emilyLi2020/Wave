// Single source of truth for all downloaded model artifacts. Test pages and
// runtime wrappers call `ensureModel(id)` to get a local path; the function
// is idempotent — returns the cached path on cache hit, downloads on miss.
//
// Storage:
//   <documentDirectory>/wave-models/<id>/<filename>
//
// We pick the document directory (not cache) for the LiteRT bundle so iOS
// doesn't reclaim a 4.7 GB download under storage pressure. Downside: the
// document directory is iCloud-backed by default. Polish item: set
// NSURLIsExcludedFromBackupKey or move to Library/Application Support/.
//
// Cache validity = (file exists) AND (size >= manifest.minBytes). A partial
// download from a previous interrupted session is treated as a miss and
// re-fetched. We currently use the legacy createDownloadResumable for the
// progress callback (the new File.downloadFileAsync has no progress hook
// in DownloadOptions); the legacy subpath import is the supported workaround
// per expo-file-system's deprecation notes.

import { Directory, File, Paths } from "expo-file-system";
import { AbortError } from "@/runtime/abort-error";
import { createDownloadResumable } from "expo-file-system/legacy";

export type ModelId =
  | "litert-wave"
  | "litert-stock-gemma4"
  | "whisper-tiny-en"
  | "whisper-base-en"
  | "silero-vad";

export interface ModelManifest {
  id: ModelId;
  label: string;
  filename: string;
  url: string;
  /** Authoritative byte size — used for the cache panel's "expected" column. */
  expectedBytes: number;
  /** Minimum size to consider a cached file valid (guards partial downloads). */
  minBytes: number;
}

export const MODELS: Record<ModelId, ModelManifest> = {
  "litert-wave": {
    id: "litert-wave",
    label: "Gemma 4 LITERTLM (WAVE fine-tune)",
    filename: "model.litertlm",
    url: "https://huggingface.co/Maelstrome/lora-wave-session-r32/resolve/main/litert-lm-v3/model.litertlm",
    expectedBytes: 2_560_956_368,
    minBytes: 2_500_000_000,
  },
  "litert-stock-gemma4": {
    id: "litert-stock-gemma4",
    label: "Gemma 4 LITERTLM (stock litert-community)",
    filename: "gemma-4-E2B-it.litertlm",
    url: "https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it.litertlm",
    expectedBytes: 2_588_147_712,
    minBytes: 2_500_000_000,
  },
  "whisper-tiny-en": {
    id: "whisper-tiny-en",
    label: "Whisper tiny.en (GGML)",
    filename: "ggml-tiny.en.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin",
    expectedBytes: 77_704_716,
    minBytes: 70_000_000,
  },
  "whisper-base-en": {
    id: "whisper-base-en",
    label: "Whisper base.en (GGML)",
    filename: "ggml-base.en.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin",
    expectedBytes: 147_964_211,
    minBytes: 140_000_000,
  },
  "silero-vad": {
    id: "silero-vad",
    label: "Silero VAD v5 (ONNX)",
    filename: "silero_vad.onnx",
    url: "https://github.com/snakers4/silero-vad/raw/master/src/silero_vad/data/silero_vad.onnx",
    expectedBytes: 2_327_524,
    minBytes: 2_000_000,
  },
};

// ────────────────────────────────────────────────────────────────────────
// Path helpers
// ────────────────────────────────────────────────────────────────────────

// Exported: LiteRT writes its MLDrift GPU program cache into the model
// file's directory (HybridLiteRTLM.cpp sets cache_dir = dirname(modelPath)).
// The stock screen probes this dir to tell cold-JIT vs. CPU fallback apart
// (Wave#17 Phase 0). Not part of the download path's public surface.
export function getModelDir(id: ModelId): Directory {
  return new Directory(Paths.document, "wave-models", id);
}

function getModelFile(id: ModelId): File {
  return new File(getModelDir(id), MODELS[id].filename);
}

// ────────────────────────────────────────────────────────────────────────
// Inspection
// ────────────────────────────────────────────────────────────────────────

export interface CacheEntry {
  id: ModelId;
  label: string;
  filename: string;
  path: string;
  url: string;
  cached: boolean;
  bytes: number;
  expectedBytes: number;
}

export async function inspectModel(id: ModelId): Promise<CacheEntry> {
  const manifest = MODELS[id];
  const file = getModelFile(id);
  const exists = file.exists;
  const bytes = exists ? file.size ?? 0 : 0;
  return {
    id,
    label: manifest.label,
    filename: manifest.filename,
    path: file.uri,
    url: manifest.url,
    cached: exists && bytes >= manifest.minBytes,
    bytes,
    expectedBytes: manifest.expectedBytes,
  };
}

export async function inspectCache(): Promise<CacheEntry[]> {
  const ids = Object.keys(MODELS) as ModelId[];
  return await Promise.all(ids.map((id) => inspectModel(id)));
}

// ────────────────────────────────────────────────────────────────────────
// Ensure (cache hit or download)
// ────────────────────────────────────────────────────────────────────────

export interface EnsureOptions {
  /** Called with progress in [0, 1]. */
  onProgress?: (pct: number) => void;
  /**
   * Optional abort signal. expo-file-system doesn't honor signals natively;
   * we check between progress callbacks and reject if aborted, but the
   * native task may continue briefly.
   */
  signal?: AbortSignal;
  /**
   * If true, delete any existing cached file first and force a re-download.
   * Useful for the "Re-download" button in the cache panel.
   */
  force?: boolean;
}

function deleteFileIfExists(file: File): void {
  if (!file.exists) return;
  try {
    file.delete();
  } catch {
    // best-effort
  }
}

export async function ensureModel(
  id: ModelId,
  opts?: EnsureOptions,
): Promise<string> {
  const manifest = MODELS[id];
  const dir = getModelDir(id);
  const file = getModelFile(id);

  if (opts?.force) {
    deleteFileIfExists(file);
  } else if (file.exists && file.size === manifest.expectedBytes) {
    opts?.onProgress?.(1);
    return file.uri;
  } else if (file.exists) {
    // Size mismatch — either a partial download from a prior attempt OR a
    // stale bundle from a previous manifest version (e.g. the old 5 GB
    // MediaPipe-flavored litert-wave bundle, now replaced by the 2.5 GB
    // litert-torch re-export). Treat as miss either way.
    deleteFileIfExists(file);
  }

  // Make sure the parent directory exists. `idempotent: true` keeps create()
  // from throwing when the directory was created by a previous run.
  dir.create({ intermediates: true, idempotent: true });

  let aborted = false;
  const dl = createDownloadResumable(
    manifest.url,
    file.uri,
    {},
    (progress: { totalBytesWritten: number; totalBytesExpectedToWrite: number }) => {
      if (opts?.signal?.aborted) {
        aborted = true;
        return;
      }
      if (progress.totalBytesExpectedToWrite > 0) {
        opts?.onProgress?.(
          progress.totalBytesWritten / progress.totalBytesExpectedToWrite,
        );
      }
    },
  );

  const result = await dl.downloadAsync();
  if (aborted || opts?.signal?.aborted) {
    deleteFileIfExists(file);
    throw new AbortError();
  }
  if (!result?.uri) {
    throw new Error(`download produced no uri for ${id}`);
  }

  // Sanity: did we actually get the expected file?
  const after = new File(result.uri);
  const afterSize = after.exists ? after.size ?? 0 : 0;
  if (!after.exists || afterSize < manifest.minBytes) {
    deleteFileIfExists(after);
    throw new Error(
      `cached ${id} is smaller than expected (got ${afterSize}b, expected at least ${manifest.minBytes}b)`,
    );
  }

  return result.uri;
}

// ────────────────────────────────────────────────────────────────────────
// Eviction
// ────────────────────────────────────────────────────────────────────────

export async function clearModel(id: ModelId): Promise<void> {
  deleteFileIfExists(getModelFile(id));
}

export async function clearAllModels(): Promise<void> {
  for (const id of Object.keys(MODELS) as ModelId[]) {
    await clearModel(id);
  }
}

// ────────────────────────────────────────────────────────────────────────
// Formatting helpers (for cache panel UI)
// ────────────────────────────────────────────────────────────────────────

export function formatBytes(bytes: number): string {
  if (!bytes || !Number.isFinite(bytes)) return "—";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 1 ? 2 : 0)} ${units[i]}`;
}
