// Canonical configuration for the WAVE fine-tune GGUF served through wllama.
//
// Everything in this file is the single source of truth for "which GGUF
// shard, on which HF repo, with what context budget, fed by which local
// mirror URL". Both the test page (`client/app/models/wllama-test/`) and the
// production runtime (eventually `client/lib/gemma/local-runtime.ts`)
// import these constants instead of hardcoding their own.

/** HF repo that contains the GGUF subdirectory. */
export const WAVE_GGUF_REPO = "Maelstrome/lora-wave-session-r32";

/** Path within the repo to the FIRST shard. wllama auto-discovers the rest. */
export const WAVE_GGUF_FILE =
  "gguf/gemma-4-e2b-it-peft.Q4_K_M-00001-of-00005.gguf";

/**
 * Default localhost path served by `client/scripts/serve-local-hf.ts` under
 * its `/gguf/` mount. Used when the test page is loaded with `?local=1`.
 */
export const LOCAL_GGUF_HOST = "http://localhost:8765";
export const LOCAL_GGUF_FIRST_SHARD =
  "/gguf/gemma-4-e2b-it-peft.Q4_K_M-00001-of-00005.gguf";

/**
 * Context size to load with. WAVE production prompts run 1800–3300 tokens
 * before the response; 8192 covers all three surfaces with headroom for the
 * model's response. Override at load time if you need more (e.g. for longer
 * session histories in `check_in`).
 */
export const WAVE_GGUF_DEFAULT_N_CTX = 8192;

/**
 * Context size to load with on mobile devices. iOS Safari caps WASM heap at
 * ~2 GiB per instance; the Q4_K_M GGUF already consumes most of that, so the
 * KV cache has to shrink. 4096 still covers the WAVE prompts (~1800-3300
 * tokens) plus a short response; if generation needs more headroom, pass an
 * explicit `nCtx` at load time.
 */
export const WAVE_GGUF_MOBILE_N_CTX = 4096;

/**
 * KV-cache element type for the mobile load path. q8_0 halves KV memory vs.
 * the default f16 (the wllama default) without measurable quality loss on
 * Gemma 4. Used by `loadWaveWllama({ mobile: true })`. Requires flash_attn
 * (also enabled in the mobile preset) per llama.cpp's KV-quantization
 * constraints.
 */
export const WAVE_GGUF_MOBILE_CACHE_TYPE = "q8_0" as const;

/**
 * Heuristic mobile detection from `navigator.userAgent`. Returns false during
 * SSR / in non-browser contexts. Used by {@link loadWaveWllama} to pick the
 * mobile load preset when the caller doesn't pass an explicit `mobile` flag.
 *
 * Covers iPhone/iPod/iPad, Android, and modern iPadOS (which spoofs Mac in
 * the UA but exposes `maxTouchPoints > 1`). Intentionally generous: a
 * misclassified desktop just loads faster than it had to; a misclassified
 * mobile would OOM.
 */
export function isLikelyMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent ?? "";
  if (/iPhone|iPod|Android|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(ua)) {
    return true;
  }
  if (/iPad/i.test(ua)) return true;
  if (
    /Macintosh/i.test(ua) &&
    typeof navigator.maxTouchPoints === "number" &&
    navigator.maxTouchPoints > 1
  ) {
    return true;
  }
  return false;
}

/**
 * Public-folder path where `wllama.wasm` is served. `next dev` and `next
 * build` both copy `client/public/wllama/wllama.wasm` to the static asset
 * root, so this URL resolves on both dev and prod.
 */
export const WLLAMA_WASM_URL = "/wllama/wllama.wasm";
