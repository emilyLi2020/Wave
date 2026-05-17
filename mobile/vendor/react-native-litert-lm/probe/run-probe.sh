#!/usr/bin/env bash
#
# run-probe.sh — CPU-first PhoneClaw viability probe (issue #1), iteration 2.
#
# Iteration 1 (standalone PhoneClawEngine@0.1.0) proved the stubbed-tokenizer
# SIGSEGV is gone with PhoneClaw packaging, but v0.1.0 hard-requires a
# TF_LITE_VISION_ENCODER even for text-only bundles, so it can't load WAVE v3.
#
# Iteration 2 (this script): the NEWER monorepo engine kellyvv/PhoneClaw @
# 0b48e5a (Gemmacademy-confirmed nullable vision/audio handling — text-only
# capable). Sparse-clones the monorepo, git-lfs-pulls the prebuilt
# xcframeworks, symlinks them + the engine sources into the SwiftPM package,
# and runs the CPU-first probe on the iOS Simulator (no Metal/device needed).
#
#   ./run-probe.sh                 # uses $WAVE_MODEL_PATH or scratch/litert-lm-v3
#   ./run-probe.sh --download      # curl the ~2.56 GB v3 bundle if absent
#
set -euo pipefail

PROBE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$PROBE_DIR/.." && pwd)"
PKG="$PROBE_DIR/PhoneClawProbe"
CLONE="$PROBE_DIR/.PhoneClaw"
PCE="$CLONE/LocalPackages/PhoneClawEngine"
CACHE="$PROBE_DIR/.cache"
RES="$PKG/Tests/PhoneClawProbeTests/Resources"
WAVE_URL="https://huggingface.co/Maelstrome/lora-wave-session-r32/resolve/main/litert-lm-v3/model.litertlm"

say() { printf '\033[1;36m[probe]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[probe] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

# 1. Full Xcode (xcodebuild + Simulator), not the CommandLineTools instance.
if [ -z "${DEVELOPER_DIR:-}" ]; then
  for X in /Applications/Xcode*.app; do
    [ -d "$X/Contents/Developer" ] && export DEVELOPER_DIR="$X/Contents/Developer" && break
  done
fi
[ -n "${DEVELOPER_DIR:-}" ] && [ -d "$DEVELOPER_DIR" ] \
  || die "Full Xcode not found. Install Xcode.app or set DEVELOPER_DIR."
say "DEVELOPER_DIR=$DEVELOPER_DIR"

# 2. Monorepo clone @ 0b48e5a — sparse + shallow, git-lfs for the xcframeworks.
if [ ! -d "$CLONE/.git" ]; then
  command -v git-lfs >/dev/null 2>&1 || die "git-lfs required. brew install git-lfs && git lfs install"
  say "Sparse-cloning kellyvv/PhoneClaw (LocalPackages/PhoneClawEngine)…"
  if git clone --depth 1 --filter=blob:none --sparse \
        https://github.com/kellyvv/PhoneClaw.git "$CLONE" 2>/dev/null; then
    git -C "$CLONE" sparse-checkout set LocalPackages/PhoneClawEngine
  else
    rm -rf "$CLONE"; git clone --depth 1 https://github.com/kellyvv/PhoneClaw.git "$CLONE"
  fi
  say "git lfs pull (engine + constraint-provider xcframeworks)…"
  git -C "$CLONE" lfs pull --include \
    "LocalPackages/PhoneClawEngine/Frameworks/LiteRTLM.xcframework,LocalPackages/PhoneClawEngine/Frameworks/GemmaModelConstraintProvider.xcframework" \
    || git -C "$CLONE" lfs pull
else
  say "Reusing existing clone at .PhoneClaw"
fi

SLICE="$PCE/Frameworks/LiteRTLM.xcframework/ios-arm64-simulator/CLiteRTLM.framework/CLiteRTLM"
[ -f "$SLICE" ] && [ "$(wc -c < "$SLICE")" -gt 100000 ] \
  || die "CLiteRTLM sim slice missing/tiny — git-lfs not pulled. Re-run after: git -C $CLONE lfs pull"
[ -f "$PCE/Sources/PhoneClawEngine/PhoneClawEngine.swift" ] || die "Engine sources missing in clone."

# 3. Symlinks into the clone (SwiftPM follows symlinks; clone stays pristine).
mkdir -p "$PKG/Frameworks" "$PKG/Sources" "$RES"
ln -sfn "../../.PhoneClaw/LocalPackages/PhoneClawEngine/Frameworks/LiteRTLM.xcframework" \
  "$PKG/Frameworks/LiteRTLM.xcframework"
ln -sfn "../../.PhoneClaw/LocalPackages/PhoneClawEngine/Frameworks/GemmaModelConstraintProvider.xcframework" \
  "$PKG/Frameworks/GemmaModelConstraintProvider.xcframework"
ln -sfn "../../.PhoneClaw/LocalPackages/PhoneClawEngine/Sources/PhoneClawEngine" \
  "$PKG/Sources/PhoneClawEngine"

# 4. Canonical prompt + host-v3 reference (single source of truth = eval/).
cp "$REPO_ROOT/eval/wave-prompts.json" "$RES/wave-prompts.json"
cp "$REPO_ROOT/eval/wave-outputs.json" "$RES/wave-outputs.json"

# 5. Resolve the WAVE v3 bundle (default: the copy already in scratch/).
MODEL="${WAVE_MODEL_PATH:-$REPO_ROOT/scratch/litert-lm-v3/model.litertlm}"
if [ ! -f "$MODEL" ]; then
  if [ "${1:-}" = "--download" ]; then
    mkdir -p "$CACHE"; MODEL="$CACHE/litert-lm-v3-model.litertlm"
    say "Downloading WAVE v3 bundle (~2.56 GB) → $MODEL"
    curl -fL --retry 3 -o "$MODEL.part" "$WAVE_URL"; mv "$MODEL.part" "$MODEL"
  else
    die "WAVE bundle not at $MODEL.  WAVE_MODEL_PATH=/abs/x.litertlm ./run-probe.sh  | or  ./run-probe.sh --download"
  fi
fi
printf '%s' "$MODEL" > "$RES/model-path.txt"
say "Model: $MODEL ($(du -h "$MODEL" | cut -f1))"

# 6. Pick a simulator — prefer an already-booted iPhone, else newest iPhone.
DEST_ID="$(xcrun simctl list devices available -j | python3 -c '
import json,sys
d=json.load(sys.stdin)["devices"]
ip=[x for rt,L in d.items() if "iOS" in rt for x in L if "iPhone" in x["name"]]
b=[x for x in ip if x.get("state")=="Booted"]
print((b or ip)[-1]["udid"] if (b or ip) else "")')"
[ -n "$DEST_ID" ] || die "No available iOS Simulator. Install one via Xcode."
say "Simulator udid: $DEST_ID"

# 7. Build + run (clean SwiftPM state — the package graph is local binaryTargets).
rm -rf "$PKG/.build" "$PKG/.swiftpm"
export TEST_RUNNER_WAVE_MODEL_PATH="$MODEL"
LOG="$PROBE_DIR/.probe-xcodebuild.log"
say "xcodebuild test (builds CLiteRTLM + PhoneClawEngine + probe)…"
set +e
( cd "$PKG" && xcodebuild test \
    -scheme PhoneClawProbe-Package \
    -destination "platform=iOS Simulator,id=$DEST_ID" \
    -resultBundlePath "$PROBE_DIR/.probe-result.xcresult" ) 2>&1 | tee "$LOG"
RC=${PIPESTATUS[0]}
set -e

echo
say "==== PROBE VERDICT ===="
if grep -q "PROBE_RESULT::" "$LOG"; then
  grep "PROBE_RESULT::" "$LOG" | tail -1 | sed 's/^.*PROBE_RESULT:://' \
    | python3 -m json.tool 2>/dev/null || grep "PROBE_RESULT::" "$LOG" | tail -1
else
  say "No PROBE_RESULT — see $LOG (build/link/load failure before generation)."
fi
exit $RC
