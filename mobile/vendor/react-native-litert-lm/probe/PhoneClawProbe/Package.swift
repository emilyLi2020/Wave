// swift-tools-version: 6.0
//
// PhoneClawProbe — CPU-first viability probe (issue #1), iteration 4.
//
// Iterations 1-3 proved (a) PhoneClaw packaging eliminates the stubbed-tokenizer
// SIGSEGV, (b) full on-device generation works, (c) the engine lineage must be
// v0.10.2 to preserve the WAVE v3 fine-tune (0b48e5a → Chinese). But the
// 0b48e5a PhoneClaw Swift wrapper is written against a much newer C API and
// won't compile against v0.10.2's engine.h (unbounded symbol drift + ABI risk).
//
// Iteration 4 (this): drop the wrapper entirely. Drive v0.10.2's OWN
// `c/engine.h` C API directly from the test — zero version coupling, exactly
// the canonical sequence in v0.10.2's `c/engine_test.cc`. We build the engine
// dylib ourselves from clean v0.10.2 + PhoneClaw's `c/BUILD` cc_binary patch
// (run-probe.sh / pkg-v0102-sim.sh), so `CLiteRTLM` is the real v0.10.2 engine
// with the real Rust HF tokenizer + minijinja statically linked in.
import PackageDescription

let package = Package(
    name: "PhoneClawProbe",
    platforms: [.iOS(.v17)],
    targets: [
        // v0.10.2 engine, self-contained (real tokenizer baked in). Built by
        // pkg-v0102-sim.sh into Frameworks/LiteRTLM.xcframework, headers =
        // v0.10.2 c/engine.h.
        .binaryTarget(
            name: "CLiteRTLM",
            path: "Frameworks/LiteRTLM.xcframework"
        ),
        // CLiteRTLM has an LC_LOAD_DYLIB on
        // @rpath/GemmaModelConstraintProvider.framework/... — embed it so
        // dyld resolves it at test-bundle load.
        .binaryTarget(
            name: "GemmaModelConstraintProvider",
            path: "Frameworks/GemmaModelConstraintProvider.xcframework"
        ),
        .testTarget(
            name: "PhoneClawProbeTests",
            dependencies: ["CLiteRTLM", "GemmaModelConstraintProvider"],
            path: "Tests/PhoneClawProbeTests",
            resources: [.process("Resources")]
        ),
    ]
)
