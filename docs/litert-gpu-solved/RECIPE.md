# ✅✅ SOLVED — Stock Gemma 4 E2B runs on iPhone GPU (~50 tok/s, was ~1.9 CPU)

On-device proof (iPhone 17 Pro): `WAVE17 tryCreateEngine backend=gpu result=OK` + `primary backend=gpu created OK (no fallback)`; `LITERT_METAL` delegates 100% of every subgraph incl. vision encoder (`Replacing 1477/1477`, `2068/2068`, `2243/2243`); MLDrift program-cache written (`…litertlm_…_mldrift_program_cache.bin` + `…vision_encoder_…_mldrift_program_cache.bin` in the app container); **user-measured ~50 tok/s** (vs ~1.9 tok/s CPU fallback). All 4 frameworks preload/load OK.

## What fixed it
The from-source `//c:engine` Bazel build compiles XNNPACK aarch64-NEON microkernels **empty** for `ios_arm64` (`xnn_init_*_config` defined, `xnn_*_ukernel__aarch64_neon_*` undefined → embedder DIV node fails XNNPACK Prepare → engine INTERNAL). Patching XNNPACK's `build_config:aarch64` was necessary-but-insufficient (more empty groups). **The winning move (from #18 / PhoneClaw): stop building the engine from source — use a prebuilt LiteRT-LM engine dylib whose XNNPACK is correctly built.**

## EXACT REPRODUCTION RECIPE (everything is currently EPHEMERAL — see "Productionize")

**1. Source the prebuilt set** — `kellyvv/PhoneClaw`, git-lfs, at `LocalPackages/PhoneClawEngine/Frameworks/`:
- `LiteRTLM.xcframework` → `ios-arm64/CLiteRTLM.framework/CLiteRTLM` (20 MB dynamic engine; install_name `@rpath/CLiteRTLM.framework/CLiteRTLM`; ships `Headers/engine.h`; exports **83 `litert_lm_*`**; hard-links `@rpath/GemmaModelConstraintProvider.framework/...`; contains correctly-built `xnn_f32_vdiv_ukernel__aarch64_neon_u8`).
- `LiteRtMetalAccelerator.xcframework` (dynamic, install_name `@rpath/libLiteRtMetalAccelerator.dylib`, ios-arm64 + sim)
- `LiteRtTopKMetalSampler.xcframework` (dynamic, `@rpath/libLiteRtTopKMetalSampler.dylib`, **ios-arm64 only, no sim slice**)
- `GemmaModelConstraintProvider.xcframework` (dynamic, `@rpath/GemmaModelConstraintProvider.framework/...`)

**2. ABI compatibility (verified):** CLiteRTLM's `engine.h` = 898 lines vs our vendored v0.11.0 `litert_lm_engine.h` 888 — only *extra* fn `litert_lm_engine_settings_set_max_num_images`; **zero** functions our bridge calls are missing. Our existing v0.11.0 bridge port works against it unchanged.

**3. Rename CLiteRTLM → LiteRTLM** (so it drops into the existing pod with ZERO CocoaPods changes — `pod install` is broken in this env, Ruby 4.0.4/CocoaPods 1.16.2):
- `cp -R CLiteRTLM.framework LiteRTLM.framework` ; `mv LiteRTLM.framework/CLiteRTLM LiteRTLM.framework/LiteRTLM`
- `install_name_tool -id @rpath/LiteRTLM.framework/LiteRTLM LiteRTLM.framework/LiteRTLM`
- PlistBuddy: `CFBundleExecutable`/`CFBundleName` → `LiteRTLM`
- Wrap as `LiteRTLM.xcframework` (ios-arm64 device slice only; we build device-only) with a minimal `Info.plist` (LibraryIdentifier `ios-arm64`, LibraryPath `LiteRTLM.framework`).
- Place at `mobile/node_modules/react-native-litert-lm/ios/Frameworks/LiteRTLM.xcframework` (replace from-source static; backup kept at `LiteRTLM.xcframework.fromsource.bak`).
- Stage the 3 plugin frameworks (ios-arm64) at `mobile/node_modules/react-native-litert-lm/ios/Frameworks/plugin-frameworks/`.

**4. Bridge** `cpp/HybridLiteRTLM.cpp` (already in place): preload dlopen the 2 runtime plugins by ABSOLUTE bundle path BEFORE `litert_lm_engine_create`:
`<bundle>/Frameworks/LiteRtMetalAccelerator.framework/LiteRtMetalAccelerator` and `…/LiteRtTopKMetalSampler.framework/LiteRtTopKMetalSampler` (RTLD_NOW|RTLD_GLOBAL). They keep dylib install-names so LiteRT's later leaf-name `dlopen("libLiteRtMetalAccelerator.dylib")` resolves the already-loaded image. Engine + GemmaModelConstraintProvider are LC_LOAD_DYLIB-linked (load at launch via `@executable_path/Frameworks` rpath — RN default). Keep the v0.11.0 C-API port (`conversation_config_create()` no-arg + setters, `kLiteRtLmSamplerTypeTopP`), `litert_lm_set_min_log_level(0)`, WAVE17 os_log, stderr→file, `set_enable_speculative_decoding(false)` (harmless). `<dlfcn.h>`+`<CoreFoundation/CoreFoundation.h>` included AFTER the NitroModules/ReactCommon headers.

**5. Build/sign/install** (`/tmp/build_inject.sh` — keep this file):
- Concurrency guard: wait while any `pgrep -f xcodebuild` (other agents share the repo); never kill builds you don't own.
- `xcodebuild -workspace mobile/ios/Wave.xcworkspace -scheme Wave -configuration Release -destination generic/platform=iOS -derivedDataPath mobile/ios/build-dd CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM=8TADX8KSDK PROVISIONING_PROFILE_SPECIFIER=27b297c0-2c95-46b2-b7c4-0f49a296f4d7 CLANG_CXX_LANGUAGE_STANDARD=gnu++20 CODE_SIGN_IDENTITY="iPhone Distribution: Jingtian Zhang (8TADX8KSDK)" build` (use existing `build-dd`, NOT fresh — clean build hits an unrelated RN `bridging/Base.h` c++17-vs-C++20 failure; the gnu++20 flag is the fix).
- Post-build: `cp -R` LiteRTLM.framework + GemmaModelConstraintProvider.framework + LiteRtMetalAccelerator.framework + LiteRtTopKMetalSampler.framework into `Wave.app/Frameworks/`; `codesign -f -s "$ID"` each framework; then `codesign -f -s "$ID" --preserve-metadata=entitlements,flags,identifier --generate-entitlement-der Wave.app` (preserve-metadata REQUIRED — re-signing with `--entitlements` clobbers `application-identifier` → install error 3002); `xcrun devicectl device install app --device D0ECA348-E755-51C0-9291-082EF5A917EA Wave.app`.
- Entitlements: `mobile/app.json` ios.entitlements has `increased-memory-limit` + `extended-virtual-addressing`; profile `27b297c0-2c95-46b2-b7c4-0f49a296f4d7` (`*[expo] com.wave.mobile AdHoc`, regenerated via `eas credentials -p ios` → preview profile → Download to credentials.json) includes both. If you `expo prebuild`, re-add `extended-virtual-addressing` to generated `ios/Wave/Wave.entitlements`.

## Acceptance / proof harness
`idevicesyslog -u 00008150-001079E40182401C -p Wave` → expect `WAVE17 tryCreateEngine backend=gpu result=OK`. Pull `Documents/wave-models/litert-stock-gemma4/litert-stderr.log` via `devicectl device copy from --domain-type appDataContainer` → expect `Replacing N/N node(s) … LITERT_METAL` and `*mldrift_program_cache*.bin` present in the container.

## ⚠️ PRODUCTIONIZE (NOT done — all changes are ephemeral in node_modules/.litert-lm-build/PhoneClaw clone/`/tmp`; `npm install` wipes them)
1. Fork `IdkwhatImD0ing/react-native-litert-lm-wave` (or new fork): vendor the renamed `LiteRTLM.xcframework` (PhoneClaw CLiteRTLM) + the 3 plugin xcframeworks; podspec `vendored_frameworks` all 4 (dynamic → embed+sign), drop the from-source `build-ios-engine.sh` path; commit the `cpp/HybridLiteRTLM.cpp` preload+port+instrumentation. Re-pin `mobile/package.json`.
2. Resolve provenance/licensing of PhoneClaw's prebuilt CLiteRTLM (Google-internal-origin per #18; for hackathon/internal use OK — clear before any distribution).
3. Add sim slices if simulator builds are needed (TopKMetalSampler has no sim slice — guard or stub for sim).
4. Bake the entitlement + gnu++20 + framework-embed steps into a config plugin so `expo prebuild` doesn't reset them.

Backups: from-source engine at `…/ios/Frameworks/LiteRTLM.xcframework.fromsource.bak`; XNNPACK patch at `/tmp/xnnpack_build_config.patched.bazel`; working build script `/tmp/build_inject.sh`. Cross-ref #18 (the lead), #17 (full diagnosis).
