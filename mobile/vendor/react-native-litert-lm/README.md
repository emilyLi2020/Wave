# react-native-litert-lm

High-performance on-device LLM inference for React Native, powered by [LiteRT-LM](https://github.com/google-ai-edge/LiteRT-LM) and [Nitro Modules](https://github.com/mrousavy/nitro). Optimized for **Gemma 4** and other on-device language models.

## Features

- 🚀 **Native Performance** — Kotlin (Android) / C++ (iOS) via Nitro Modules JSI bindings
- 🧠 **Gemma 4 Ready** — First-class support for Gemma 4 E2B/E4B multimodal models (text + vision + audio)
- ⚡ **GPU Acceleration** — Metal (iOS), OpenCL GPU delegate (Android, Pixel devices)
- 🔄 **Streaming Support** — Token-by-token generation callbacks
- 📱 **Cross-Platform** — Android API 26+ / iOS 15.0+
- 🖼️ **Multimodal** — Image and audio input support
- 🧵 **Async API** — Non-blocking inference on dedicated large-stack threads
- 📊 **Real Memory Tracking** — OS-level memory metrics (RSS, native heap, available memory) via native APIs
- 🧮 **Zero-Copy Buffers** — Memory snapshots stored in native ArrayBuffers via Nitro Modules
- 📥 **Automatic Model Download** — Downloads models from URL with progress tracking and local caching

## Demo

> Gemma 4 E2B running on-device on a Samsung Galaxy S22 (Snapdragon 8 Gen 1, 4 GB RAM) — CPU backend, streaming inference.

<video src="https://github.com/user-attachments/assets/1da527ce-0432-4f8b-8899-474f81b2feea" width="300" controls></video>

## Installation

```bash
npm install react-native-litert-lm react-native-nitro-modules
```

### Expo

Add to your `app.json`:

```json
{
  "expo": {
    "plugins": ["react-native-litert-lm"],
    "android": {
      "minSdkVersion": 26
    }
  }
}
```

Then create a development build:

```bash
npx expo prebuild
npx expo run:android  # Android
npx expo run:ios      # iOS
```

> **Note**: Only ARM devices/simulators are supported. x86_64 Android emulators are not supported.

### Bare React Native

```bash
# Android
cd android && ./gradlew clean

# iOS
cd ios && pod install
```

## Example App

The `example/` directory contains a fully functional test app with a dark-themed diagnostic UI that demonstrates:

- Model downloading with progress tracking
- Text inference (blocking and streaming)
- Multi-turn conversation with context retention
- Performance benchmarking (tokens/sec, latency)
- Real-time memory tracking
- Quick chat interface

### Running the Example

1. **Build the library** (compiles TypeScript to `lib/`):

   ```bash
   npm run build
   ```

2. **Install example dependencies:**

   ```bash
   cd example
   npm install
   ```

3. **Create a development build and run:**

   ```bash
   npx expo prebuild --clean
   npx expo run:android  # Android
   npx expo run:ios      # iOS (requires XCFramework — see "Building the iOS Engine" below)
   ```

> **Note:** If you change native code (C++/Kotlin/Obj-C++), you must run `npx expo prebuild --clean` again before rebuilding.

## Model Management

LiteRT-LM models (like Gemma 4) are large files (1–4 GB) and cannot be bundled into your app binary. They are downloaded at runtime.

### Automatic Downloading

Pass an HTTPS URL to `useModel()` or `loadModel()` — the library handles the rest:

- **Progress tracking** — real-time download percentage via callbacks
- **Local caching** — downloaded models are cached and reused across app launches
  - **Android**: `files/models/` (app-private)
  - **iOS**: `Library/Caches/litert_models/` (survives app relaunch; reclaimable by iOS under storage pressure)
- **HTTPS enforcement** — only secure URLs are accepted

### Manual Downloading

If you need custom control over downloads (e.g., authentication headers for private model hosting, resumable downloads, or custom caching), use your preferred HTTP client and pass the local file path:

```typescript
import { fetch } from "expo/fetch";
import { File, Paths } from "expo-file-system";
import { useModel } from "react-native-litert-lm";

const MODEL_URL = "https://example.com/private-model.litertlm";

// Download with custom headers using expo/fetch
const response = await fetch(MODEL_URL, {
  headers: { Authorization: `Bearer ${token}` },
});
const modelFile = new File(Paths.cache, "my-model.litertlm");
modelFile.write(await response.bytes());

// Pass the local path — no download occurs
const { model, isReady } = useModel(modelFile.uri, { backend: "cpu" });
```

## Usage

### React Hook (Recommended)

The `useModel` hook manages the full model lifecycle: downloading, loading, inference, and cleanup.

```typescript
import { useModel, GEMMA_4_E2B_IT } from "react-native-litert-lm";
import { Platform } from "react-native";

function App() {
  const {
    model,
    isReady,
    downloadProgress,
    error,
    load,          // Manually trigger load
    deleteModel,   // Delete cached model file
    memorySummary, // Auto-updated memory stats (if tracking enabled)
  } = useModel(GEMMA_4_E2B_IT, {
    backend: 'cpu',
    autoLoad: true, // Default: true. Set false to load manually via load().
    systemPrompt: "You are a helpful assistant.",
    enableMemoryTracking: true,
  });

  if (!isReady) {
    return <Text>Loading... {Math.round(downloadProgress * 100)}%</Text>;
  }

  const generate = async () => {
    const response = await model.sendMessage("Hello!");
    console.log(response);
  };

  return <Button title="Generate" onPress={generate} />;
}
```

### Manual Usage

```typescript
import { createLLM } from "react-native-litert-lm";

const llm = createLLM();

// Load a model from URL (auto-downloads) or local path
await llm.loadModel("https://example.com/model.litertlm", {
  backend: "gpu",
  systemPrompt: "You are a helpful assistant.",
});

// Generate a response
const response = await llm.sendMessage("What is the capital of France?");
console.log(response);

// Clean up
llm.close();
```

### Streaming Generation

```typescript
llm.sendMessageAsync("Tell me a story", (token, done) => {
  process.stdout.write(token);
  if (done) console.log("\n--- Done ---");
});
```

### Multimodal (Image / Audio)

> **Note**: Multimodal is fully supported on Android. iOS has the code paths implemented but vision/audio executors may not be available in the current XCFramework build — use `checkMultimodalSupport()` to verify at runtime.

```typescript
import { checkMultimodalSupport } from "react-native-litert-lm";

const warning = checkMultimodalSupport();
if (warning) {
  console.warn(warning); // Experimental on iOS
} else {
  // Image input (for vision models like Gemma 4)
  // Images >1024px are automatically resized to prevent OOM
  const response = await llm.sendMessageWithImage(
    "What's in this image?",
    "/path/to/image.jpg",
  );

  // Audio input
  const transcription = await llm.sendMessageWithAudio(
    "Transcribe this audio",
    "/path/to/audio.wav",
  );
}
```

### Performance Stats

```typescript
const stats = llm.getStats();
console.log(`Generated ${stats.completionTokens} tokens`);
console.log(`Speed: ${stats.tokensPerSecond.toFixed(1)} tokens/sec`);
console.log(`Time to first token: ${stats.timeToFirstToken.toFixed(0)} ms`);
```

### Memory Tracking

The library provides real OS-level memory data — no estimation. It reads directly from `mach_task_basic_info` (iOS) and `Debug.getNativeHeapAllocatedSize()` + `/proc/self/status` (Android).

#### Direct Memory Query

```typescript
const usage = llm.getMemoryUsage();
console.log(
  `Native heap: ${(usage.nativeHeapBytes / 1024 / 1024).toFixed(1)} MB`,
);
console.log(`RSS: ${(usage.residentBytes / 1024 / 1024).toFixed(1)} MB`);
console.log(
  `Available: ${(usage.availableMemoryBytes / 1024 / 1024).toFixed(1)} MB`,
);
console.log(`Low memory: ${usage.isLowMemory}`);
```

#### Automatic Tracking with Native Buffers

Enable memory tracking to automatically record snapshots in a native-backed `ArrayBuffer` after every inference call:

```typescript
const llm = createLLM({
  enableMemoryTracking: true,
  maxMemorySnapshots: 256,
});

await llm.loadModel("/path/to/model.litertlm", { backend: "cpu" });
await llm.sendMessage("Hello!");

const summary = llm.memoryTracker!.getSummary();
console.log(
  `Peak RSS: ${(summary.peakResidentBytes / 1024 / 1024).toFixed(1)} MB`,
);
console.log(
  `RSS Delta: ${(summary.residentDeltaBytes / 1024 / 1024).toFixed(1)} MB`,
);
```

#### Using `useModel` with Memory Tracking

```typescript
const { model, isReady, memorySummary } = useModel(modelUrl, {
  enableMemoryTracking: true,
  maxMemorySnapshots: 100,
});

// memorySummary auto-updates after each inference call
if (memorySummary) {
  console.log(`Current RSS: ${memorySummary.currentResidentBytes}`);
  console.log(`Peak RSS: ${memorySummary.peakResidentBytes}`);
}
```

#### Standalone Memory Tracker

```typescript
import {
  createMemoryTracker,
  createNativeBuffer,
} from "react-native-litert-lm";

const tracker = createMemoryTracker(100);

tracker.record({
  timestamp: Date.now(),
  nativeHeapBytes: 50_000_000,
  residentBytes: 200_000_000,
  availableMemoryBytes: 4_000_000_000,
});

// Access the underlying native buffer (zero-copy transfer to native code)
const buffer = tracker.getNativeBuffer();
```

## Supported Models

All exported model URLs are **public — no authentication required**. Pass them directly to `useModel()` or `loadModel()` for automatic downloading with progress tracking and local caching.

| Constant               | Model                           | Size    | Min RAM | Source      |
| :--------------------- | :------------------------------ | :------ | :------ | :---------- |
| `GEMMA_4_E2B_IT`       | Gemma 4 E2B (Multimodal, IT)    | 2.58 GB | 4 GB+   | HuggingFace |
| `GEMMA_4_E4B_IT`       | Gemma 4 E4B (Higher Quality)    | 3.65 GB | 6 GB+   | HuggingFace |
| `GEMMA_3N_E2B_IT_INT4` | Gemma 3n E2B (Int4, Multimodal) | ~1.3 GB | 4 GB+   | litert.dev  |

> **Recommended:** Use `GEMMA_4_E2B_IT` for most use cases — multimodal (text + vision + audio) and the best quality-to-size ratio.
>
> **iOS Note:** Models larger than ~2 GB require the `com.apple.developer.kernel.extended-virtual-addressing` entitlement. See [iOS Entitlements](#ios-entitlements) below. Gemma 3n E2B (~1.3 GB) works without it.

**Other compatible models** (download `.litertlm` files manually from [HuggingFace](https://huggingface.co/litert-community)):

| Model         | Size    | Min RAM | Notes                 |
| ------------- | ------- | ------- | --------------------- |
| Gemma 3 1B    | ~1 GB   | 4 GB+   | Smallest, fastest     |
| Phi-4 Mini    | ~2 GB   | 4 GB+   | Microsoft's small LLM |
| Qwen 2.5 1.5B | ~1.5 GB | 4 GB+   | Multilingual          |

### Custom fine-tuned `.litertlm` bundles

Custom LoRA fine-tunes exported to a single pre-merged `.litertlm` bundle load
through the **standard API with no special configuration** — pass the bundle
path to `loadModel()` (or a URL to `useModel()` / `downloadModel()`) and use
`sendMessage` / `sendMessageAsync` as usual. Runtime LoRA-adapter switching is
not required for pre-merged bundles.

The WAVE Gemma 4 E2B fine-tune
([`Maelstrome/lora-wave-session-r32`](https://huggingface.co/Maelstrome/lora-wave-session-r32),
`mediapipe/model.litertlm`, ~4.95 GB) is **verified working** on the LiteRT
runtime — see [`eval/LAYER1_RESULTS.md`](./eval/LAYER1_RESULTS.md). The
[`eval/`](./eval/) harness is a reusable, zero-dependency way to smoke-test any
custom bundle before wiring it into the app.

## API Reference

### `createLLM(options?): LiteRTLM`

Creates a new LLM inference engine instance.

- `options.enableMemoryTracking` — enable automatic memory snapshot recording
- `options.maxMemorySnapshots` — max number of snapshots to retain (default: 256)

### `loadModel(path, config?): Promise<void>`

Loads a model from a local path or HTTPS URL.

| Parameter             | Type     | Default | Description                               |
| --------------------- | -------- | ------- | ----------------------------------------- |
| `path`                | `string` | —       | Absolute path to `.litertlm` or HTTPS URL |
| `config.backend`      | `string` | `'cpu'` | `'cpu'`, `'gpu'`, or `'npu'`              |
| `config.systemPrompt` | `string` | —       | System prompt for the model               |
| `config.temperature`  | `number` | `0.7`   | Sampling temperature                      |
| `config.topK`         | `number` | `40`    | Top-K sampling                            |
| `config.topP`         | `number` | `0.95`  | Top-P (nucleus) sampling                  |
| `config.maxTokens`    | `number` | `1024`  | Maximum generation length                 |

#### Backend Options

| Backend | Engine                         | Speed   | Notes                                                                              |
| ------- | ------------------------------ | ------- | ---------------------------------------------------------------------------------- |
| `'cpu'` | CPU inference                  | Slowest | Always available on all devices                                                    |
| `'gpu'` | Metal (iOS) / OpenCL (Android) | Fast    | iOS: always available. Android: requires OpenCL (Pixel only, not Samsung/Qualcomm) |
| `'npu'` | NPU / Neural Engine            | Fastest | Requires supported hardware; experimental                                          |

> **iOS**: Both `'cpu'` and `'gpu'` (Metal) are supported. The engine automatically tries fallback backend combinations if the primary one fails.
>
> **Android GPU**: The GPU backend requires OpenCL, which is **not available on most Samsung and Qualcomm devices**. Use `checkBackendSupport('gpu')` to check before loading. The engine will throw a clear error if GPU is unsupported.

### `sendMessage(message): Promise<string>`

Runs inference synchronously on a background thread. Returns the complete response.

### `sendMessageAsync(message, callback)`

Streaming generation. Callback signature: `(token: string, isDone: boolean) => void`.

### `sendMessageWithImage(message, imagePath): Promise<string>`

Send a message with an image (for vision models like Gemma 4 E2B).

### `sendMessageWithAudio(message, audioPath): Promise<string>`

Send a message with audio (for audio-capable models like Gemma 4 E2B).

### `getStats(): GenerationStats`

Returns performance metrics from the last inference call.

```typescript
interface GenerationStats {
  tokensPerSecond: number;
  totalTime: number; // milliseconds
  timeToFirstToken: number; // milliseconds
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}
```

> **Note**: Stats are available for both sync (`sendMessage`) and streaming (`sendMessageAsync`) on both platforms. iOS uses real benchmark data from the C API; Android uses heuristic token counts (~4 chars/token) with precise timing.

### `getMemoryUsage(): MemoryUsage`

Returns real OS-level memory usage.

```typescript
interface MemoryUsage {
  nativeHeapBytes: number;
  residentBytes: number;
  availableMemoryBytes: number;
  isLowMemory: boolean;
}
```

### `getHistory(): Message[]`

Returns the conversation history.

### `resetConversation()`

Clears conversation context and starts a fresh session.

### `close()`

Releases all native resources. Call when the model is no longer needed.

### `deleteModel(fileName): Promise<void>`

Deletes a cached model file from the app's local storage.

### Utility Functions

```typescript
import {
  checkBackendSupport,
  checkMultimodalSupport,
  getRecommendedBackend,
  applyGemmaTemplate,
  applyPhiTemplate,
  applyLlamaTemplate,
} from "react-native-litert-lm";

// Check if GPU is supported on this device
const gpuWarning = checkBackendSupport("gpu");
if (gpuWarning) {
  console.warn(gpuWarning);
  // "GPU backend requires OpenCL support, which is unavailable on most Samsung and Qualcomm devices."
}

// Check NPU support
const npuWarning = checkBackendSupport("npu"); // string | undefined

// Check multimodal support
const mmError = checkMultimodalSupport(); // string | undefined

// Get recommended backend
const backend = getRecommendedBackend(); // 'cpu'

// Manual prompt formatting (advanced)
const prompt = applyGemmaTemplate(
  [{ role: "user", content: "Hello!" }],
  "You are helpful.",
);
```

## Requirements

| Dependency                 | Version       |
| -------------------------- | ------------- |
| React Native               | 0.76+         |
| react-native-nitro-modules | 0.35.0+       |
| Android API                | 26+ (ARM64)   |
| iOS                        | 15.0+ (ARM64) |
| LiteRT-LM Engine           | 0.10.2        |

## Platform Support

| Platform | Status   | Architecture | Backends                                          |
| -------- | -------- | ------------ | ------------------------------------------------- |
| Android  | ✅ Ready | arm64-v8a    | CPU (all devices), GPU (OpenCL devices only), NPU |
| iOS      | ✅ Ready | arm64        | CPU, GPU (Metal — always available)               |

### iOS Feature Matrix

| Feature                      | Status | Notes                                                 |
| ---------------------------- | ------ | ----------------------------------------------------- |
| Text inference (blocking)    | ✅     | Via LiteRT-LM C API                                   |
| Text inference (streaming)   | ✅     | Token-by-token callbacks                              |
| CPU inference                | ✅     | Recommended default backend                           |
| GPU inference (Metal/MPS)    | ✅     | Supported via `backend: 'gpu'`                        |
| Model download with progress | ✅     | NSURLSession, cached in `Caches/`                     |
| Memory tracking              | ✅     | `mach_task_basic_info`                                |
| Multi-turn conversation      | ✅     | Context retained across turns                         |
| Multimodal (image/audio)     | 🧪     | Code paths exist; vision/audio executors experimental |
| Constrained decoding         | ❌     | Requires llguidance Rust runtime                      |
| Function calling             | ❌     | Requires Rust CXX bridge runtime                      |

### iOS Entitlements

Models larger than ~2 GB (like Gemma 4 E2B at 2.58 GB) require the **Extended Virtual Addressing** entitlement on iOS physical devices. Without it, iOS limits virtual memory to ~2 GB and the app will be killed by Jetsam.

Add to your app's `.entitlements` file:

```xml
<key>com.apple.developer.kernel.extended-virtual-addressing</key>
<true/>
```

> **Note:** This entitlement requires a **paid Apple Developer account** ($99/year). Gemma 3n E2B (~1.3 GB) works without it.

## Building the iOS Engine

The iOS build uses a **Bazel-to-XCFramework pipeline** that compiles the LiteRT-LM C engine and all transitive dependencies into a static library (~82–84 MB).

### Prerequisites

- **Bazel 7.6.1+** (via [Bazelisk](https://github.com/bazelbuild/bazelisk) recommended)
- **Xcode command line tools** (`xcode-select --install`)

### Build

```bash
./scripts/build-ios-engine.sh
```

This will:

1. Clone/checkout LiteRT-LM `v0.10.2` source into `.litert-lm-build/`
2. Apply `scripts/patches/ios-engine-fixes.patch` (PromptTemplate simplification, linker fixes)
3. Build `//c:engine` for `ios_arm64` and `ios_sim_arm64` via Bazel
4. Collect all transitive `.o` files (engine, protobuf, re2, sentencepiece, etc.)
5. Compile C/C++ stubs for unavailable Rust dependencies
6. Merge ~1,909 object files into a static library via `libtool`
7. Package into `ios/Frameworks/LiteRTLM.xcframework`

### Output

```
ios/Frameworks/LiteRTLM.xcframework/
├── Info.plist
├── ios-arm64/LiteRTLM.framework/              # Device
│   ├── LiteRTLM                                # ~82 MB static library
│   └── Headers/litert_lm_engine.h
└── ios-arm64-simulator/LiteRTLM.framework/    # Simulator
    ├── LiteRTLM                                # ~84 MB static library
    └── Headers/litert_lm_engine.h
```

### FFI Stubs

Certain LiteRT-LM features depend on Rust libraries (llguidance, CXX bridge, MinijinjaTemplate) that are not available in the iOS Bazel build. These are replaced with stubs:

| Stub File                            | Location         | Purpose                                  |
| ------------------------------------ | ---------------- | ---------------------------------------- |
| `cxx_bridge_stubs.cc`                | `scripts/stubs/` | CXX bridge runtime + Rust FFI type stubs |
| `llguidance_stubs.c`                 | `scripts/stubs/` | llguidance constrained decoding C API    |
| `gemma_model_constraint_provider.cc` | `scripts/stubs/` | Gemma constraint provider factory        |

Additionally, `PromptTemplate` is patched at build time to use a simplified C++ template formatter instead of the Rust MinijinjaTemplate, which avoids all Rust FFI calls during conversation setup.

> **Caveat (iOS).** These stubs are safe only for models whose tokenizer does
> not use the HuggingFace Rust FFI. For HF-tokenizer-backed models (e.g. Gemma 4
> `.litertlm` bundles), the stubbed `tokenizers_decode` / `tokenizers_encode`
> return `nullptr` and **text inference crashes** (`EXC_BAD_ACCESS` in
> `HFTokenizer::Decode` during prefill). A non-stubbed engine — built by letting
> Bazel link the whole engine into `//c:libLiteRTLMEngine.dylib` rather than the
> static `find *.o` + `libtool` merge (see issue #1) — is required for
> HF-tokenizer text inference on iOS. Constrained decoding, function-calling
> parsers, and advanced Jinja2 templates remain unaffected regardless.

## Architecture

```
┌─────────────────────────────────────────────────┐
│  React Native (TypeScript)                      │
│  useModel() / createLLM() / sendMessage()       │
├─────────────────────────────────────────────────┤
│  Nitro Modules JSI Bridge                       │
├──────────────────────┬──────────────────────────┤
│  Android (Kotlin)    │  iOS (C++)               │
│  HybridLiteRTLM.kt   │  HybridLiteRTLM.cpp      │
│  litertlm-android    │  LiteRT-LM C API         │
│  AAR (GPU delegate)  │  XCFramework (Metal)     │
└──────────────────────┴──────────────────────────┘
```

- **Android**: Kotlin (`HybridLiteRTLM.kt`) interfacing with the `litertlm-android` AAR via the **Kotlin SDK**. The SDK handles control token stripping and turn management automatically. Engine validation probes for OpenCL availability before GPU initialization. `ConversationConfig` with `SamplerConfig` is passed for all conversations (matching the Gallery app pattern).
- **iOS**: C++ (`HybridLiteRTLM.cpp`) interfacing with the LiteRT-LM **C API** via a prebuilt `LiteRTLM.xcframework`. Unlike the Kotlin SDK, the C API emits raw tokens including control sequences (`<end_of_turn>`, `<start_of_turn>`) and echoed user messages. The C++ layer implements a robust sanitization pipeline:
  - **Accumulation-and-diff** — buffers the full response and emits only new deltas
  - **`stripControlTokens()`** — removes all control sequences from the accumulated buffer
  - **`safeEmitLength()`** — look-ahead buffering that withholds partial control tokens (e.g., `<end_of_tur`) from emission until the full token is received or the stream terminates
  - **Echo mitigation** — strips echoed user messages from the raw stream
  - **Final flush** — mandatory clean-and-flush step on stream termination

  Platform-specific code (model downloading, file management) is in Objective-C++ (`ios/IOSDownloadHelper.mm`).

> **For contributors**: Changes to `cpp/HybridLiteRTLM.cpp` do not affect Android. Feature changes must be applied to both the Kotlin and C++ implementations.

## License

The code in this repository is licensed under the **[MIT License](LICENSE)**.

### ⚠️ AI Model Disclaimer

This library is an execution engine for on-device LLMs. The AI models themselves are **not** distributed with this package and have their own licenses:

- **Gemma (Google)**: [Gemma Terms of Use](https://ai.google.dev/gemma/terms)
- **Llama 3 (Meta)**: [Llama 3.2 Community License](https://www.llama.com/llama3/license/)
- **Qwen (Alibaba)**: [Apache 2.0](https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct/blob/main/LICENSE)
- **Phi (Microsoft)**: [MIT License](https://huggingface.co/microsoft/Phi-3.5-mini-instruct/blob/main/LICENSE)

By downloading and using these models, you agree to their respective licenses and acceptable use policies. The author of `react-native-litert-lm` takes no responsibility for model outputs or applications built with them.
