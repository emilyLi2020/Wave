#!/bin/bash
# build-ios-engine.sh
#
# Builds the LiteRT-LM C engine as a SELF-CONTAINED DYNAMIC framework for iOS
# (device + simulator) using Bazel, then packages it — plus its companion
# GemmaModelConstraintProvider plugin — into XCFrameworks for CocoaPods.
#
# This is the "PhoneClaw recipe" proven end-to-end by the issue #1 probe:
# instead of building //c:engine (a cc_library) and hand-merging every
# transitive .o with libtool — which forced stubbing the HuggingFace Rust
# tokenizer FFI to nullptr and caused the on-device EXC_BAD_ACCESS — we let
# Bazel link the whole engine into one cc_binary dylib
# (//c:libLiteRTLMEngine.dylib). Bazel pulls the REAL Rust tokenizer +
# minijinja in as normal deps; no stubs, no libtool merge, no patches.
#
# Lineage: LiteRT-LM v0.10.2 (package.json litertLm.iosGitTag) — the lineage
# that host-validated the WAVE v3 fine-tune. Newer mains (e.g. 0b48e5a) do not
# preserve it (probe: Chinese/degenerate output).
#
# Prerequisites:
#   - Bazel 7.6.1+ (bazelisk recommended)
#   - git-lfs  (LiteRT-LM LFS-tracks prebuilt/*/*.dylib; required)
#   - Xcode (full, not just CLT) — set DEVELOPER_DIR if xcode-select points at CLT
#
# Usage:   ./scripts/build-ios-engine.sh
# Output:  ios/Frameworks/LiteRTLM.xcframework/                  (engine, device+sim)
#          ios/Frameworks/GemmaModelConstraintProvider.xcframework/  (companion)
#          cpp/include/litert_lm_engine.h                         (vendored C API)

set -euo pipefail

LITERT_LM_REPO="https://github.com/google-ai-edge/LiteRT-LM.git"
FRAMEWORK_NAME="LiteRTLM"
GMCP_NAME="GemmaModelConstraintProvider"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LITERT_LM_VERSION="$(node -e "console.log(require('$PROJECT_ROOT/package.json').litertLm.iosGitTag)")"
OUTPUT_DIR="$PROJECT_ROOT/ios/Frameworks"
C_API_HEADER_DIR="$PROJECT_ROOT/cpp/include"
BUILD_DIR="$PROJECT_ROOT/.litert-lm-build"
LITERT_SRC="$BUILD_DIR/LiteRT-LM"
MIN_IOS="15.0"

echo "==> Building LiteRT-LM ${LITERT_LM_VERSION} engine dylib for iOS (PhoneClaw recipe)..."

# Full Xcode (bazel apple toolchain + xcodebuild need it, not the CLT instance)
if [ -z "${DEVELOPER_DIR:-}" ] && ! xcodebuild -version >/dev/null 2>&1; then
  for X in /Applications/Xcode*.app; do
    [ -d "$X/Contents/Developer" ] && export DEVELOPER_DIR="$X/Contents/Developer" && break
  done
fi

command -v git-lfs >/dev/null 2>&1 || {
  echo "Error: git-lfs is required (LiteRT-LM LFS-tracks prebuilt/*/*.dylib)."
  echo "Install:  brew install git-lfs && git lfs install"; exit 1; }

# ---- 1. LiteRT-LM source @ the pinned tag -------------------------------
echo "==> Step 1: LiteRT-LM source @ ${LITERT_LM_VERSION}..."
if [ -f "$LITERT_SRC/.bazelrc" ]; then
  cd "$LITERT_SRC"
  git fetch --tags 2>/dev/null || true
  git checkout "$LITERT_LM_VERSION" 2>/dev/null || git checkout "tags/$LITERT_LM_VERSION"
else
  rm -rf "$LITERT_SRC"; mkdir -p "$BUILD_DIR"
  git clone --depth 1 --branch "$LITERT_LM_VERSION" "$LITERT_LM_REPO" "$LITERT_SRC"
  cd "$LITERT_SRC"
fi

# Real engine binaries are LFS-tracked; pull the iOS slices we link against.
echo "   git lfs pull (prebuilt iOS dylibs)..."
git lfs pull --include "prebuilt/ios_arm64/*,prebuilt/ios_sim_arm64/*" 2>/dev/null \
  || git lfs pull

# ---- 2. Inject the cc_binary engine-dylib target (idempotent) -----------
# The ONLY source change. Mirrors PhoneClaw's c/BUILD patch: ask Bazel to
# link the whole engine (incl. the real Rust HF tokenizer + minijinja, via
# //runtime/core:engine_impl) into one self-contained, dynamically-loadable
# dylib that exports just the litert_lm_* / LiteRt* C ABI.
if ! grep -q 'name = "libLiteRTLMEngine.dylib"' c/BUILD; then
  echo "==> Step 2: appending //c:libLiteRTLMEngine.dylib to c/BUILD..."
  cat >> c/BUILD <<'CCBIN'

# Added by react-native-litert-lm scripts/build-ios-engine.sh (issue #1).
# Self-contained engine dylib — real Rust tokenizer linked in, no stubs.
cc_binary(
    name = "libLiteRTLMEngine.dylib",
    srcs = [
        "engine.cc",
        "engine.h",
    ],
    linkopts = [
        "-Wl,-exported_symbol,_litert_lm_*",
        "-Wl,-exported_symbol,_LiteRt*",
    ],
    linkshared = True,
    linkstatic = True,
    visibility = ["//visibility:public"],
    deps = ENGINE_COMMON_DEPS + [
        "//runtime/core:engine_impl",
    ],
)
CCBIN
else
  echo "==> Step 2: c/BUILD already has libLiteRTLMEngine.dylib (skip)."
fi

# ---- 3. Bazel: build the engine dylib for device + simulator ------------
if command -v bazelisk &>/dev/null; then BAZEL="bazelisk"; else BAZEL="bazel"; fi
echo "==> Step 3: $BAZEL ($($BAZEL --version 2>&1 | head -1)) building engine dylib..."
$BAZEL build -c opt --config=ios_arm64     //c:libLiteRTLMEngine.dylib 2>&1 | tail -3
DEVICE_ENGINE="$LITERT_SRC/bazel-out/ios_arm64-opt/bin/c/libLiteRTLMEngine.dylib"
$BAZEL build -c opt --config=ios_sim_arm64 //c:libLiteRTLMEngine.dylib 2>&1 | tail -3
SIM_ENGINE="$LITERT_SRC/bazel-out/ios_sim_arm64-opt/bin/c/libLiteRTLMEngine.dylib"
for f in "$DEVICE_ENGINE" "$SIM_ENGINE"; do
  [ -f "$f" ] && file "$f" | grep -q Mach-O || { echo "Error: engine dylib not built: $f"; exit 1; }
done
DEVICE_GMCP="$LITERT_SRC/prebuilt/ios_arm64/lib${GMCP_NAME}.dylib"
SIM_GMCP="$LITERT_SRC/prebuilt/ios_sim_arm64/lib${GMCP_NAME}.dylib"
for f in "$DEVICE_GMCP" "$SIM_GMCP"; do
  file "$f" 2>/dev/null | grep -q Mach-O || { echo "Error: $f not a Mach-O (git lfs pull failed?)"; exit 1; }
done

# ---- 4. Vendor the v0.10.2 C API header --------------------------------
echo "==> Step 4: vendoring c/engine.h -> cpp/include/litert_lm_engine.h..."
mkdir -p "$C_API_HEADER_DIR"
cp "$LITERT_SRC/c/engine.h" "$C_API_HEADER_DIR/litert_lm_engine.h"

# ---- 5. Package framework slices + XCFrameworks ------------------------
echo "==> Step 5: packaging XCFrameworks..."
SIM_SDK="$(xcrun --sdk iphonesimulator --show-sdk-version)"
DEV_SDK="$(xcrun --sdk iphoneos --show-sdk-version)"
WORK="$BUILD_DIR/fw-work"; rm -rf "$WORK"; mkdir -p "$WORK"
rm -rf "$OUTPUT_DIR"; mkdir -p "$OUTPUT_DIR"

write_plist() { # dir name bundleid
  cat > "$1/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>CFBundleExecutable</key><string>$2</string>
  <key>CFBundleIdentifier</key><string>$3</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>$2</string>
  <key>CFBundlePackageType</key><string>FMWK</string>
  <key>CFBundleShortVersionString</key><string>0.10.2</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>MinimumOSVersion</key><string>$MIN_IOS</string>
</dict></plist>
PLIST
}
setver() { # binary platformcode  (2=iOS, 7=iOS-Simulator); non-fatal
  local t="$1.vt"
  xcrun vtool -set-build-version "$2" "$MIN_IOS" "$3" -replace -output "$t" "$1" 2>/dev/null \
    && mv "$t" "$1" || rm -f "$t"
}

# slice: engine + companion for one platform
# args: tag platformcode sdkver engine_dylib gmcp_dylib
make_slice() {
  local tag="$1" pcode="$2" sdk="$3" eng="$4" gmcp="$5"
  local d="$WORK/$tag"
  local G="$d/$GMCP_NAME.framework"; mkdir -p "$G"
  cp "$gmcp" "$G/$GMCP_NAME"
  install_name_tool -id "@rpath/$GMCP_NAME.framework/$GMCP_NAME" "$G/$GMCP_NAME"
  setver "$G/$GMCP_NAME" "$pcode" "$sdk"
  write_plist "$G" "$GMCP_NAME" "com.google.$GMCP_NAME"
  codesign --force --sign - "$G"

  local F="$d/$FRAMEWORK_NAME.framework"; mkdir -p "$F/Headers" "$F/Modules"
  cp "$eng" "$F/$FRAMEWORK_NAME"
  install_name_tool -id "@rpath/$FRAMEWORK_NAME.framework/$FRAMEWORK_NAME" "$F/$FRAMEWORK_NAME"
  for old in $(otool -L "$F/$FRAMEWORK_NAME" | awk "/$GMCP_NAME/{print \$1}"); do
    install_name_tool -change "$old" \
      "@rpath/$GMCP_NAME.framework/$GMCP_NAME" "$F/$FRAMEWORK_NAME" 2>/dev/null || true
  done
  setver "$F/$FRAMEWORK_NAME" "$pcode" "$sdk"
  cp "$C_API_HEADER_DIR/litert_lm_engine.h" "$F/Headers/litert_lm_engine.h"
  cat > "$F/Modules/module.modulemap" <<MM
framework module $FRAMEWORK_NAME {
    header "litert_lm_engine.h"
    export *
}
MM
  write_plist "$F" "$FRAMEWORK_NAME" "com.google.ai.edge.litert-lm"
  codesign --force --sign - "$F"
}

make_slice "ios-arm64"            2 "$DEV_SDK" "$DEVICE_ENGINE" "$DEVICE_GMCP"
make_slice "ios-arm64-simulator"  7 "$SIM_SDK" "$SIM_ENGINE"    "$SIM_GMCP"

xcodebuild -create-xcframework \
  -framework "$WORK/ios-arm64/$FRAMEWORK_NAME.framework" \
  -framework "$WORK/ios-arm64-simulator/$FRAMEWORK_NAME.framework" \
  -output "$OUTPUT_DIR/$FRAMEWORK_NAME.xcframework" >/dev/null
xcodebuild -create-xcframework \
  -framework "$WORK/ios-arm64/$GMCP_NAME.framework" \
  -framework "$WORK/ios-arm64-simulator/$GMCP_NAME.framework" \
  -output "$OUTPUT_DIR/$GMCP_NAME.xcframework" >/dev/null

# ---- 6. Release-asset zip ----------------------------------------------
cd "$OUTPUT_DIR"
zip -qr "$PROJECT_ROOT/LiteRTLM-ios-frameworks.zip" . -x ".*"

echo "==> Done. iOS engine (v0.10.2, real tokenizer) packaged:"
find "$OUTPUT_DIR" -maxdepth 1 -name "*.xcframework" -exec echo "  {}" \;
echo "  $(du -h "$PROJECT_ROOT/LiteRTLM-ios-frameworks.zip" | cut -f1)  LiteRTLM-ios-frameworks.zip"
