#!/usr/bin/env bash
#
# pkg-v0102-sim.sh — wrap the v0.10.2 Bazel-built engine dylib + the prebuilt
# GemmaModelConstraintProvider into iOS-Simulator xcframeworks for the probe.
#
# Sim-only, faithful subset of PhoneClaw's patches/package-xcframework.sh
# (create_engine_slice / create_plugin_slice). The probe runs CPU-only on the
# simulator, so device slices and the GPU dlopen plugins are not needed.
#
# Run AFTER: bazel build -c opt --config=ios_sim_arm64 //c:libLiteRTLMEngine.dylib
set -euo pipefail

PROBE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LM="$(cd "$PROBE_DIR/../.litert-lm-build/LiteRT-LM" && pwd)"
ENGINE="$LM/bazel-bin/c/libLiteRTLMEngine.dylib"
GMCP="$LM/prebuilt/ios_sim_arm64/libGemmaModelConstraintProvider.dylib"
HDR="$LM/c/engine.h"
OUT="$PROBE_DIR/PhoneClawProbe/Frameworks"
WORK="$PROBE_DIR/.pkg-work"
MIN_IOS="17.0"
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
SIM_SDK="$(xcrun --sdk iphonesimulator --show-sdk-version)"

say() { printf '\033[1;36m[pkg]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[pkg] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

[ -f "$ENGINE" ] || die "engine dylib not built: $ENGINE"
file "$ENGINE" | grep -q "Mach-O" || die "engine dylib not Mach-O (LFS pointer?): $ENGINE"
[ -f "$GMCP" ]   || die "constraint-provider prebuilt missing: $GMCP"
file "$GMCP" | grep -q "Mach-O" || die "GMCP is not Mach-O — run: git -C $LM lfs pull --include 'prebuilt/ios_sim_arm64/*'"
[ -f "$HDR" ]    || die "engine.h missing: $HDR"

rm -rf "$WORK"; mkdir -p "$WORK" "$OUT"

plist() {  # dir name bundleid
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
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>MinimumOSVersion</key><string>$MIN_IOS</string>
</dict></plist>
PLIST
}
setver() { # binary — platform 7 = IOSSIMULATOR. Non-fatal: the Bazel
           # ios_sim_arm64 dylib already carries a valid sim LC_BUILD_VERSION;
           # this only normalises the MinimumOSVersion floor (App-Store
           # concern), not needed for a local simulator test.
  local t="$1.vt"
  if xcrun vtool -set-build-version 7 "$MIN_IOS" "$SIM_SDK" -replace -output "$t" "$1" 2>/dev/null; then
    mv "$t" "$1"
  else
    rm -f "$t"
    say "vtool set-build-version skipped (using Bazel's build version) for $(basename "$1")"
  fi
}

# --- GemmaModelConstraintProvider.framework (sim) ---
G="$WORK/GemmaModelConstraintProvider.framework"; mkdir -p "$G"
cp "$GMCP" "$G/GemmaModelConstraintProvider"
install_name_tool -id "@rpath/GemmaModelConstraintProvider.framework/GemmaModelConstraintProvider" "$G/GemmaModelConstraintProvider"
setver "$G/GemmaModelConstraintProvider"
plist "$G" "GemmaModelConstraintProvider" "com.google.GemmaModelConstraintProvider"
codesign --force --sign - "$G"
say "GemmaModelConstraintProvider.framework ok"

# --- CLiteRTLM.framework (sim) ---
C="$WORK/CLiteRTLM.framework"; mkdir -p "$C/Headers" "$C/Modules"
cp "$ENGINE" "$C/CLiteRTLM"
install_name_tool -id "@rpath/CLiteRTLM.framework/CLiteRTLM" "$C/CLiteRTLM"
# Rewrite the constraint-provider load command to the companion framework path,
# whatever shape v0.10.2's link produced (bazel solib path, bare name, @rpath).
for old in $(otool -L "$C/CLiteRTLM" | awk '/GemmaModelConstraintProvider/{print $1}'); do
  install_name_tool -change "$old" \
    "@rpath/GemmaModelConstraintProvider.framework/GemmaModelConstraintProvider" \
    "$C/CLiteRTLM" 2>/dev/null || true
done
setver "$C/CLiteRTLM"
cp "$HDR" "$C/Headers/engine.h"
# v0.10.2 <-> 0b48e5a wrapper C-API compat shim. The PhoneClaw 0b48e5a Swift
# wrapper uses renamed enum constants and a v0.11+ conversation builder fn that
# don't exist in v0.10.2's engine.h. Real v0.10.2 names: kInputText, kTopK,
# kTopP, kGreedy. The conversation builder is used ONLY on the conversation
# path (vision/audio/multi-turn) which this text-only Session-API probe never
# executes, so a no-op stub is correct here. `static const` (not #define) so
# Swift's ClangImporter reliably imports them as typed constants.
cat >> "$C/Headers/engine.h" <<'SHIM'

/* ---- probe: v0.10.2 <-> 0b48e5a wrapper compat shim (issue #1) ---- */
static const InputDataType kLiteRtLmInputDataTypeText  = kInputText;
static const InputDataType kLiteRtLmInputDataTypeImage = kInputImage;
static const InputDataType kLiteRtLmInputDataTypeAudio = kInputAudio;
static const Type kLiteRtLmSamplerTypeTopK   = kTopK;
static const Type kLiteRtLmSamplerTypeTopP   = kTopP;
static const Type kLiteRtLmSamplerTypeGreedy = kGreedy;
static inline void litert_lm_conversation_config_set_session_config(
    LiteRtLmConversationConfig* conv_config,
    LiteRtLmSessionConfig* session_config) {
  (void)conv_config; (void)session_config; /* v0.11+ only; unused on text path */
}
/* ---- end compat shim ---- */
SHIM
cat > "$C/Modules/module.modulemap" <<MM
framework module CLiteRTLM {
    header "engine.h"
    export *
}
MM
plist "$C" "CLiteRTLM" "com.google.CLiteRTLM"
codesign --force --sign - "$C"
say "CLiteRTLM.framework ok"
say "CLiteRTLM otool -L:"; otool -L "$C/CLiteRTLM" | sed 's/^/    /'

rm -rf "$OUT/CLiteRTLM.xcframework" "$OUT/GemmaModelConstraintProvider.xcframework" \
       "$OUT/LiteRTLM.xcframework"
xcodebuild -create-xcframework -framework "$C" -output "$OUT/LiteRTLM.xcframework" >/dev/null
xcodebuild -create-xcframework -framework "$G" -output "$OUT/GemmaModelConstraintProvider.xcframework" >/dev/null
say "xcframeworks written to $OUT:"
ls -1 "$OUT"
say "DONE — repoint probe symlinks->real dirs handled by Package.swift paths; now run the probe."
