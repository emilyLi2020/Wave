#!/usr/bin/env bash
set -euo pipefail
cd /home/ubuntu
echo "[build] starting at $(date -u)"
# Install cmake if missing
if ! command -v cmake >/dev/null 2>&1; then
  echo "[build] installing cmake via apt"
  sudo apt-get update -qq
  sudo apt-get install -qq -y cmake build-essential
fi
# Clone llama.cpp
if [ ! -d "$HOME/llama.cpp" ]; then
  echo "[build] cloning llama.cpp"
  git clone --depth 1 https://github.com/ggml-org/llama.cpp.git "$HOME/llama.cpp"
fi
cd "$HOME/llama.cpp"
echo "[build] cmake configure (CPU-only — we just need quantize/split/cli)"
cmake -B build -DGGML_CUDA=OFF -DBUILD_SHARED_LIBS=OFF -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF -DLLAMA_BUILD_SERVER=OFF
echo "[build] compile (this takes a few minutes)"
cmake --build build --config Release --target llama-quantize llama-gguf-split llama-cli -j$(nproc)
echo "[build] binaries:"
ls -la build/bin/llama-quantize build/bin/llama-gguf-split build/bin/llama-cli
echo "[build] done at $(date -u)"
