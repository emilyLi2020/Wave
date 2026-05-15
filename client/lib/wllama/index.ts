// Public surface of the wllama wrapper. Import from "@/lib/wllama" instead
// of reaching into the individual files.

export {
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

export {
  describeWaveWllamaSource,
  loadWaveWllama,
  type LoadWaveWllamaOptions,
  type WllamaInstance,
} from "./client";
