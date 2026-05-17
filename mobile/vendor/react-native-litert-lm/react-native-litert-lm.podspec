require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "react-native-litert-lm"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]
  s.platforms    = { :ios => "15.0" }
  s.source       = { :git => package["repository"]["url"], :tag => "#{s.version}" }
  
  s.swift_version = '5.0'

  s.source_files = [
    # Implementation (C++)
    "cpp/**/*.{hpp,cpp,h}",
    # Autolinking (Objective-C++)
    "ios/**/*.{m,mm}",
    # Nitrogen generated iOS bridge
    "nitrogen/generated/ios/**/*.{mm,swift}",
  ]

  # Exclude Android-only JNI files from iOS build
  s.exclude_files = [
    "cpp/cpp-adapter.cpp",
  ]

  # GPU-WORKING set (branch wave/clitertlm-v0110-gpu): PREBUILT LiteRT-LM
  # v0.11.0 engine (PhoneClaw's CLiteRTLM, renamed -> LiteRTLM) instead of the
  # from-source v0.10.2 dylib. The from-source Bazel build compiles XNNPACK
  # aarch64-NEON microkernels EMPTY for ios_arm64 (embedder DIV node fails
  # XNNPACK Prepare -> engine INTERNAL); the prebuilt v0.11.0 engine has
  # correct XNNPACK + the Metal accelerator. VERIFIED on iPhone 17 Pro:
  # stock Gemma 4 E2B at ~50 tok/s on GPU (was ~1.9 CPU). Engine is
  # model-agnostic -> the same path runs FINE-TUNED .litertlm bundles.
  # See docs/CLITERTLM-GPU-RECIPE.md. Engine hard-links Gemma companion
  # (LC_LOAD_DYLIB @rpath); Metal accelerator + TopK sampler are runtime
  # dlopen plugins (preloaded by cpp/HybridLiteRTLM.cpp before
  # litert_lm_engine_create). All four must be vendored & embedded.
  s.vendored_frameworks = [
    'ios/Frameworks/LiteRTLM.xcframework',
    'ios/Frameworks/GemmaModelConstraintProvider.xcframework',
    'ios/Frameworks/LiteRtMetalAccelerator.xcframework',
    'ios/Frameworks/LiteRtTopKMetalSampler.xcframework',
  ]

  s.pod_target_xcconfig = {
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++20',
    'CLANG_CXX_LIBRARY' => 'libc++',
    'HEADER_SEARCH_PATHS' => [
      '"$(PODS_TARGET_SRCROOT)/cpp"',
      '"$(PODS_TARGET_SRCROOT)/cpp/include"',
      '"$(PODS_TARGET_SRCROOT)/nitrogen/generated/shared/c++"',
      '"$(PODS_TARGET_SRCROOT)/nitrogen/generated/ios"',
    ].join(' '),
    'OTHER_LDFLAGS' => '$(inherited) -ObjC',
  }

  # NOTE: the prior static-library xcframework had its LiteRT engine
  # registrars dead-stripped (empty engine registry at runtime). That is
  # RESOLVED by the dynamic cc_binary recipe in scripts/build-ios-engine.sh:
  # //c:libLiteRTLMEngine.dylib is linkstatic+linkshared, so Bazel retains the
  # registrars and the real Rust tokenizer; no stubs, no libtool merge. Proven
  # end-to-end on-device by the issue #1 probe (English WAVE generation at the
  # v0.10.2 fine-tune-preserving lineage).

  # Load nitrogen autolinking
  load 'nitrogen/generated/ios/LiteRTLM+autolinking.rb'
  add_nitrogen_files(s)

  # Core React Native dependencies
  s.dependency 'React-jsi'
  s.dependency 'React-callinvoker'
  s.dependency 'ReactCommon/turbomodule/core'

  # Apple frameworks needed by LiteRT-LM engine
  # Metal/MPS: GPU inference, Accelerate: BLAS/LAPACK, CoreML: delegate
  s.frameworks = ['Metal', 'MetalPerformanceShaders', 'Accelerate', 'CoreML', 'CoreGraphics']
  s.libraries = ['c++']

  install_modules_dependencies(s)
end

