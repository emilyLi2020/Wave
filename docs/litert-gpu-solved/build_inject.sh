set -uo pipefail
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
M=/Users/artemis/Documents/Github/Wave/mobile
ID="iPhone Distribution: Jingtian Zhang (8TADX8KSDK)"
DD=$M/ios/build-dd
APP=$DD/Build/Products/Release-iphoneos/Wave.app
ENGINE_FW=$M/node_modules/react-native-litert-lm/ios/Frameworks/LiteRTLM.xcframework/ios-arm64/LiteRTLM.framework
PLUG=$M/node_modules/react-native-litert-lm/ios/Frameworks/plugin-frameworks

# Build-concurrency guard (memory: other agents share this repo; concurrent
# xcodebuilds on shared derived-data corrupt the ModuleCache). Wait for any
# in-progress xcodebuild to finish; never kill one we don't own.
W=0
while pgrep -f "[x]codebuild" >/dev/null 2>&1; do
  echo "  [guard] another xcodebuild is running; waiting ($W s)..."
  sleep 15; W=$((W+15)); [ $W -ge 1800 ] && { echo "guard timeout"; break; }
done

rm -rf "$APP"
echo "== xcodebuild Release (DD=$DD) =="
xcodebuild -workspace "$M/ios/Wave.xcworkspace" -scheme Wave -configuration Release \
  -destination 'generic/platform=iOS' -derivedDataPath "$DD" \
  CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM=8TADX8KSDK \
  PROVISIONING_PROFILE_SPECIFIER=27b297c0-2c95-46b2-b7c4-0f49a296f4d7 \
  CLANG_CXX_LANGUAGE_STANDARD=gnu++20 CODE_SIGN_IDENTITY="$ID" build > /tmp/xcodebuild7.log 2>&1
echo "xcodebuild rc=$? ; $(grep -cE '\*\* BUILD SUCCEEDED \*\*' /tmp/xcodebuild7.log) success"
if ! grep -qE '\*\* BUILD SUCCEEDED \*\*' /tmp/xcodebuild7.log; then
  echo "BUILD_FAILED — first errors:"; grep -nE "error: " /tmp/xcodebuild7.log | grep -viE "warning:" | head -8
  echo "INJECT_DONE"; exit 1
fi
[ -d "$APP" ] || { echo "NO APP despite success?"; echo INJECT_DONE; exit 1; }

echo "== embed + sign engine + 3 plugin frameworks (PhoneClaw CLiteRTLM arch) =="
mkdir -p "$APP/Frameworks"
# Engine first (LC_LOAD_DYLIB-linked, not auto-embedded since pod was static-era)
rm -rf "$APP/Frameworks/LiteRTLM.framework"
cp -R "$ENGINE_FW" "$APP/Frameworks/LiteRTLM.framework"
codesign -f -s "$ID" "$APP/Frameworks/LiteRTLM.framework" && echo "  ok LiteRTLM.framework (engine)"
for fw in GemmaModelConstraintProvider LiteRtMetalAccelerator LiteRtTopKMetalSampler; do
  rm -rf "$APP/Frameworks/$fw.framework"
  cp -R "$PLUG/$fw.framework" "$APP/Frameworks/$fw.framework"
  codesign -f -s "$ID" "$APP/Frameworks/$fw.framework" && echo "  ok $fw.framework"
done
codesign -f -s "$ID" --preserve-metadata=entitlements,flags,identifier --generate-entitlement-der "$APP" && echo "  app re-sealed"
codesign --verify --deep --strict "$APP" 2>&1 && echo "  verify OK"
xcrun devicectl device install app --device D0ECA348-E755-51C0-9291-082EF5A917EA "$APP" 2>&1 | grep -iE "App installed|bundleID|error:" | tail -2
echo "INJECT_DONE"
