# LiteRT-LM Headers Fallback

This directory contains the LiteRT-LM C API header (`litert_lm_engine.h`) used by the iOS C++ implementation.

## If Headers Are Missing

If you get compilation errors like `litert_lm_engine.h: No such file or directory`, you need to manually copy the LiteRT-LM C API header here:

1. Clone LiteRT-LM repository:

   ```bash
   git clone https://github.com/google-ai-edge/LiteRT-LM.git /tmp/LiteRT-LM
   cd /tmp/LiteRT-LM && git checkout v0.10.2
   ```

2. Copy the header:
   ```bash
   cp /tmp/LiteRT-LM/c/litert_lm_engine.h ./
   ```

The expected directory structure after copying:

```
cpp/include/
├── litert_lm_engine.h   # LiteRT-LM C API header
├── stb_image.h          # Image loading for multimodal
└── README.md
```

## Note

On **Android**, headers are provided by the `litertlm-android` AAR via Prefab — this directory is only needed for the **iOS** build which uses the raw C API via the prebuilt XCFramework.
