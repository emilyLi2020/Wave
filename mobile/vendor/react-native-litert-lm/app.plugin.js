/**
 * Expo config plugin for react-native-litert-lm.
 *
 * Ensures correct build settings for the LiteRT-LM native module:
 * - Android: minSdkVersion 26, Kotlin 2.3.0 (required by litertlm-android AAR)
 */
const {
  withGradleProperties,
  withProjectBuildGradle,
  withXcodeProject,
} = require('@expo/config-plugins');

// iOS: the PhoneClaw v0.11.0 engine + its podspec ship LiteRtMetalAccelerator
// and LiteRtTopKMetalSampler as .framework binaries, but their Mach-O
// install-name is dylib-style (@rpath/libLiteRtMetalAccelerator.dylib).
// CocoaPods links the vendored frameworks, so the APP binary gets a hard
// LC_LOAD_DYLIB on @rpath/libLiteRtMetalAccelerator.dylib — a bare dylib
// name that doesn't exist (only the .framework does), so dyld aborts the
// process at launch before any code runs (DYLD "Library missing").
//
// Fix: an app-target build phase that drops bare lib*.dylib copies next to
// the CocoaPods-embedded .frameworks in the app's Frameworks dir, so the
// LC_LOAD_DYLIB resolves. The .framework copies stay (CocoaPods embeds +
// signs them) so cpp/HybridLiteRTLM.cpp's runtime dlopen of the framework
// path still works and the engine's later leaf-name dlopen resolves the
// already-loaded image. Source is the vendored package on disk (stable
// node_modules path) so this is independent of CocoaPods phase ordering.
// Survives `expo prebuild` because it is a config plugin.
const LITERT_DYLIB_PHASE = 'LiteRT: alias Metal plugin dylibs';
const LITERT_DYLIB_SCRIPT = [
  'set -u',
  'SRCBASE="${SRCROOT}/../node_modules/react-native-litert-lm/ios/Frameworks"',
  'DST="${TARGET_BUILD_DIR}/${FRAMEWORKS_FOLDER_PATH}"',
  'mkdir -p "$DST"',
  'for N in LiteRtMetalAccelerator LiteRtTopKMetalSampler; do',
  '  SRC="$SRCBASE/$N.xcframework/ios-arm64/$N.framework/$N"',
  '  if [ -f "$SRC" ]; then',
  '    cp -f "$SRC" "$DST/lib$N.dylib"',
  '    if [ -n "${EXPANDED_CODE_SIGN_IDENTITY:-}" ]; then',
  '      codesign --force --sign "$EXPANDED_CODE_SIGN_IDENTITY" "$DST/lib$N.dylib" || true',
  '    fi',
  '    echo "LiteRT: aliased $N -> lib$N.dylib"',
  '  else',
  '    echo "LiteRT: WARN missing $SRC"',
  '  fi',
  'done',
].join('\n');

function withLiteRTLM(config) {
  // Android: Ensure minSdkVersion is at least 26
  config = withGradleProperties(config, (config) => {
    const props = config.modResults;

    // Set minSdkVersion if not already high enough
    const minSdkProp = props.find((p) => p.key === 'android.minSdkVersion');
    if (!minSdkProp) {
      props.push({
        type: 'property',
        key: 'android.minSdkVersion',
        value: '26',
      });
    } else if (parseInt(minSdkProp.value, 10) < 26) {
      minSdkProp.value = '26';
    }

    return config;
  });

  // Android: Pin Kotlin Gradle plugin to 2.3.0
  // The litertlm-android AAR uses Kotlin 2.3.0 metadata (version defined in
  // package.json → litertLm.androidMavenVersion).
  // React Native's default Kotlin version (2.1.0) cannot read this metadata,
  // so we must force the Kotlin Gradle plugin to 2.3.0 in the project-level
  // build.gradle. This ensures the fix survives `expo prebuild --clean`.
  config = withProjectBuildGradle(config, (config) => {
    if (config.modResults.language === 'groovy') {
      const contents = config.modResults.contents;

      // Only add if not already pinned
      if (!contents.includes("kotlin-gradle-plugin:2.3.0")) {
        // Replace the unversioned kotlin-gradle-plugin classpath with a pinned one
        config.modResults.contents = contents.replace(
          "classpath('org.jetbrains.kotlin:kotlin-gradle-plugin')",
          "classpath('org.jetbrains.kotlin:kotlin-gradle-plugin:2.3.0')"
        );
      }
    }

    return config;
  });

  // iOS: add the bare-dylib alias build phase to the app target so the
  // app binary's LC_LOAD_DYLIB on @rpath/libLiteRt*Metal*.dylib resolves
  // (otherwise dyld kills the app at launch — DYLD "Library missing").
  config = withXcodeProject(config, (config) => {
    const proj = config.modResults;
    const phases = proj.hash.project.objects['PBXShellScriptBuildPhase'] || {};
    const already = Object.values(phases).some(
      (p) => p && typeof p === 'object' && p.name && String(p.name).includes('alias Metal plugin dylibs')
    );
    if (!already) {
      proj.addBuildPhase(
        [],
        'PBXShellScriptBuildPhase',
        LITERT_DYLIB_PHASE,
        proj.getFirstTarget().uuid,
        { shellPath: '/bin/sh', shellScript: LITERT_DYLIB_SCRIPT }
      );
    }
    return config;
  });

  return config;
}

module.exports = withLiteRTLM;
