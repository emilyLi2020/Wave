// Thin wllama wrapper: configures the WASM path once and loads the WAVE GGUF
// either from HF (default, works in dev/preview/prod) or from a local-hf
// mirror at localhost:8765 (faster iteration when working on the GGUF
// itself; requires `pnpm exec tsx scripts/serve-local-hf.ts` running).
//
// The wllama package ships a non-existent `index.js` at its package root
// (`main` field in its package.json), which makes Turbopack fall back to
// the `index.ts` source file and fail to compile it as a module of unknown
// type. We import from the explicit `esm/index.js` subpath to sidestep that.

import {
  isLikelyMobileDevice,
  LOCAL_GGUF_FIRST_SHARD,
  LOCAL_GGUF_HOST,
  WAVE_GGUF_DEFAULT_N_CTX,
  WAVE_GGUF_FILE,
  WAVE_GGUF_MOBILE_CACHE_TYPE,
  WAVE_GGUF_MOBILE_N_CTX,
  WAVE_GGUF_REPO,
  WLLAMA_WASM_URL,
} from "./config";

type KVCacheType =
  | "f32"
  | "f16"
  | "q8_0"
  | "q5_1"
  | "q5_0"
  | "q4_1"
  | "q4_0";

type WllamaModule = typeof import("@wllama/wllama/esm/index.js");
export type WllamaInstance = InstanceType<WllamaModule["Wllama"]>;

/** Lazy-load the wllama module. Keeps the WASM binding out of the SSR bundle. */
async function importWllama(): Promise<WllamaModule> {
  return import("@wllama/wllama/esm/index.js");
}

/**
 * Probe whether the browser exposes a working WebGPU adapter. Returns false
 * during SSR, when `navigator.gpu` is missing (older Safari, locked-down
 * browsers), or when `requestAdapter()` rejects/returns null (initialization
 * blocked, no compatible GPU). Used by {@link loadWaveWllama} to pick
 * between the WebGPU-friendly and WASM-friendly mobile presets — see
 * comment on {@link LoadWaveWllamaOptions.mobile} for why this matters.
 */
async function probeWebGpu(): Promise<boolean> {
  if (typeof navigator === "undefined") return false;
  const gpu = (
    navigator as unknown as {
      gpu?: { requestAdapter(): Promise<unknown> };
    }
  ).gpu;
  if (!gpu) return false;
  try {
    const adapter = await gpu.requestAdapter();
    return adapter !== null;
  } catch {
    return false;
  }
}

export interface LoadWaveWllamaOptions {
  /**
   * Override the context window the model is loaded with. Default
   * {@link WAVE_GGUF_DEFAULT_N_CTX} = 8192 on desktop and
   * {@link WAVE_GGUF_MOBILE_N_CTX} = 4096 on mobile, both of which cover all
   * three WAVE surfaces (phase / check_in / reflection) with response
   * headroom.
   */
  nCtx?: number;

  /**
   * If true, fetch the GGUF from a local-hf mirror at
   * {@link LOCAL_GGUF_HOST}{@link LOCAL_GGUF_FIRST_SHARD} instead of HF.
   * Defaults to false. Set true via `?local=1` in test pages.
   */
  useLocalMirror?: boolean;

  /**
   * Override the local-hf mirror host. Only consulted when
   * {@link useLocalMirror} is true. Defaults to {@link LOCAL_GGUF_HOST}.
   */
  localHost?: string;

  /**
   * Optional progress callback fired during shard download(s). Called with
   * cumulative `loaded` / `total` byte counts and a derived `percent`.
   */
  onProgress?: (info: {
    loaded: number;
    total: number;
    percent: number;
  }) => void;

  /**
   * Apply the mobile load preset. The preset branches on runtime WebGPU
   * availability (probed via `navigator.gpu.requestAdapter()`):
   *
   * - **Mobile + WebGPU** (iPhone Safari 26+, modern Android Chrome):
   *   - `nCtx` → {@link WAVE_GGUF_MOBILE_N_CTX} (4096, down from 8192)
   *   - KV cache → f16 (wllama default), all layers on WebGPU
   *   - No `flash_attn` override
   *
   *   Rationale: when layers offload to WebGPU, both weights and KV cache
   *   live in GPU memory, not the WASM heap, so iOS Safari's ~2 GiB heap
   *   cap doesn't bind. f16 KV avoids wllama 3.1.1's missing-`SET_ROWS`
   *   abort that quantized KV triggers on the WebGPU backend.
   *
   * - **Mobile + no WebGPU** (older iOS, locked-down browsers):
   *   - `nCtx` → {@link WAVE_GGUF_MOBILE_N_CTX} (4096)
   *   - KV cache → {@link WAVE_GGUF_MOBILE_CACHE_TYPE} ("q8_0", halves KV)
   *   - `flash_attn` → true (required for quantized KV under llama.cpp)
   *   - `n_gpu_layers` → 0 (force WASM; no GPU adapter to use anyway)
   *
   *   Rationale: WASM-only execution puts the 3.2 GB Q4_K_M model in the
   *   WASM heap, leaving little room for KV. q8_0 KV halves that footprint
   *   to fit alongside the model in iOS Safari's ~2 GiB heap.
   *
   * Threading is *not* pinned by the preset — wllama auto-detects
   * SharedArrayBuffer at load time and only uses multi-thread WASM when
   * cross-origin isolation is active (set up via the COOP/COEP headers in
   * `next.config.ts`). Pass {@link nThreads} explicitly to override.
   *
   * Defaults to {@link isLikelyMobileDevice}'s answer when omitted. Pass
   * `false` to force the desktop preset on a mobile UA (useful if a tablet
   * has plenty of headroom and you want the full 8192 context). Individual
   * overrides ({@link nCtx}, {@link cacheTypeK}, etc.) win over the preset.
   */
  mobile?: boolean;

  /**
   * Override the KV-cache element type for keys. wllama's default is `f16`.
   * Mobile preset uses {@link WAVE_GGUF_MOBILE_CACHE_TYPE} ("q8_0").
   */
  cacheTypeK?: KVCacheType;

  /**
   * Override the KV-cache element type for values. wllama's default is `f16`.
   * Mobile preset uses {@link WAVE_GGUF_MOBILE_CACHE_TYPE} ("q8_0").
   */
  cacheTypeV?: KVCacheType;

  /**
   * Override flash-attention. Off by default on desktop, on by default for
   * the mobile preset. llama.cpp requires flash_attn when KV is quantized
   * below f16, which is why the mobile preset turns it on alongside q8_0
   * KV.
   */
  flashAttn?: boolean;

  /**
   * Override thread count. By default wllama auto-detects: it uses
   * `navigator.hardwareConcurrency / 2` workers when SharedArrayBuffer is
   * available (cross-origin isolation active), and falls back to 1 thread
   * otherwise. Set this to 1 explicitly to force single-thread even when
   * SAB is available — useful as an A/B baseline.
   */
  nThreads?: number;

  /**
   * Override number of layers to offload to the GPU. wllama 3.1+ defaults to
   * "all layers on WebGPU" when a WebGPU adapter is available. Pass `0` to
   * force the WASM CPU backend.
   *
   * Default: undefined (let wllama pick all-on-WebGPU) on desktop and on
   * mobile-with-WebGPU. The mobile-without-WebGPU branch of the {@link
   * mobile} preset sets `0` automatically since there's no GPU adapter to
   * use and the preset's q8_0 KV needs the CPU backend.
   *
   * Why you'd force WASM manually: wllama 3.1.1's WebGPU backend does not
   * implement the `SET_ROWS` op that llama.cpp uses to update quantized KV
   * tensors (`cache_type_k/v != "f16"`). If you pass `cacheTypeK: "q8_0"`
   * yourself on a WebGPU-capable browser, it'll abort with `pre-allocated
   * tensor (cache_k_l0 (view)) in a buffer (WebGPU) that cannot run the
   * operation (SET_ROWS) — RuntimeError: unreachable` on the first
   * `createChatCompletion`. Force `nGpuLayers: 0` to dodge.
   */
  nGpuLayers?: number;
}

/**
 * Load the WAVE fine-tune GGUF into a fresh wllama instance and return it.
 *
 * - Default: fetches from `Maelstrome/lora-wave-session-r32/gguf/...-00001-of-00005.gguf`
 *   on HF. wllama auto-discovers the 4 remaining shards from the first.
 * - With `useLocalMirror: true`: fetches from `localhost:8765/gguf/...`
 *   served by `client/scripts/serve-local-hf.ts`.
 */
export async function loadWaveWllama(
  options: LoadWaveWllamaOptions = {},
): Promise<WllamaInstance> {
  const mobile = options.mobile ?? isLikelyMobileDevice();
  // The mobile preset's KV quantization (q8_0) trips wllama 3.1.1's missing
  // WebGPU SET_ROWS kernel and aborts model load. So when we're on mobile we
  // need to know up front whether WebGPU is available: yes → keep f16 KV +
  // WebGPU, no → q8_0 KV + force WASM. Desktop skips the probe (default is
  // already f16 KV + WebGPU and we want wllama's own fallback to handle the
  // rare desktop-without-WebGPU case).
  const mobileWebgpu = mobile ? await probeWebGpu() : false;
  const applyQuantizedKvPreset = mobile && !mobileWebgpu;
  const nCtx =
    options.nCtx ??
    (mobile ? WAVE_GGUF_MOBILE_N_CTX : WAVE_GGUF_DEFAULT_N_CTX);
  const cacheTypeK =
    options.cacheTypeK ??
    (applyQuantizedKvPreset ? WAVE_GGUF_MOBILE_CACHE_TYPE : undefined);
  const cacheTypeV =
    options.cacheTypeV ??
    (applyQuantizedKvPreset ? WAVE_GGUF_MOBILE_CACHE_TYPE : undefined);
  const flashAttn =
    options.flashAttn ?? (applyQuantizedKvPreset ? true : undefined);
  const nGpuLayers =
    options.nGpuLayers ?? (applyQuantizedKvPreset ? 0 : undefined);
  // Don't override n_threads on mobile: wllama already falls back to 1 when
  // SharedArrayBuffer is unavailable. With COOP/COEP set (see
  // next.config.ts) iOS 17+/Android Chrome will have SAB and benefit from
  // multi-thread decode; pinning to 1 here would forfeit that gain.
  const nThreads = options.nThreads;
  const useLocal = options.useLocalMirror ?? false;
  const localHost = options.localHost ?? LOCAL_GGUF_HOST;

  const mod = await importWllama();
  const wllama = new mod.Wllama({
    default: WLLAMA_WASM_URL,
    "single-thread/wllama.wasm": WLLAMA_WASM_URL,
  });

  const progressCallback = options.onProgress
    ? ({ loaded, total }: { loaded: number; total: number }) => {
        const percent = total ? Math.round((loaded / total) * 100) : 0;
        options.onProgress?.({ loaded, total, percent });
      }
    : undefined;

  // log_level=3 (WARN) suppresses llama.cpp's chatty INFO logs about the
  // slot/server prompt-cache (update_slots, create_check, restored/erased
  // checkpoint). Those messages are useful diagnostics but Chrome surfaces
  // them as console.warn since llama.cpp writes them to stderr inside WASM.
  //
  // swa_full=true makes Gemma 4's sliding-window-attention cache cover the
  // full context rather than just the 512-token window. We need this because
  // the WAVE prompts (1800-3300 tokens) far exceed the SWA window, and
  // llama.cpp's slot/server harness has a known crashing bug
  // (server-context.cpp:2848, https://github.com/ggml-org/llama.cpp/pull/20277)
  // when prefill exceeds the SWA window on the first createChatCompletion.
  // Costs ~250 MiB extra KV cache memory at n_ctx=8192 (~125 MiB at the
  // mobile n_ctx=4096), in exchange for generation that actually completes.
  const loadParams: Record<string, unknown> = {
    n_ctx: nCtx,
    swa_full: true,
    log_level: 3, // LogLevel.WARN; keeps real warnings + errors only.
    progressCallback,
  };
  if (cacheTypeK !== undefined) loadParams.cache_type_k = cacheTypeK;
  if (cacheTypeV !== undefined) loadParams.cache_type_v = cacheTypeV;
  if (flashAttn !== undefined) loadParams.flash_attn = flashAttn;
  if (nThreads !== undefined) loadParams.n_threads = nThreads;
  if (nGpuLayers !== undefined) loadParams.n_gpu_layers = nGpuLayers;

  if (useLocal) {
    const url = `${localHost}${LOCAL_GGUF_FIRST_SHARD}`;
    await wllama.loadModelFromUrl(url, loadParams);
  } else {
    await wllama.loadModelFromHF(
      { repo: WAVE_GGUF_REPO, file: WAVE_GGUF_FILE },
      loadParams,
    );
  }

  return wllama;
}

/**
 * Helper that returns the URL the model will be fetched from, given the
 * same options. Useful for display strings and progress messages without
 * duplicating the local-vs-HF branch in callers.
 */
export function describeWaveWllamaSource(
  options: Pick<LoadWaveWllamaOptions, "useLocalMirror" | "localHost"> = {},
): string {
  const useLocal = options.useLocalMirror ?? false;
  const localHost = options.localHost ?? LOCAL_GGUF_HOST;
  return useLocal
    ? `${localHost}${LOCAL_GGUF_FIRST_SHARD}`
    : `https://huggingface.co/${WAVE_GGUF_REPO}/blob/main/${WAVE_GGUF_FILE}`;
}
