import XCTest
import Foundation
import CLiteRTLM  // v0.10.2 c/engine.h, driven directly (no wrapper / no shim)

// CPU-first viability probe (issue #1), iteration 4 — direct v0.10.2 C API.
//
// Drives v0.10.2's own engine.h exactly as its canonical c/engine_test.cc
// does (settings(model,"cpu",NULL,NULL) → engine → session(greedy,seed7) →
// generate_content(kInputText) → response_text). CLiteRTLM is the engine we
// built from clean v0.10.2 + PhoneClaw's c/BUILD cc_binary patch, so the real
// Rust HF tokenizer + minijinja are statically linked in. Question answered:
// does the v0.10.2 (WAVE-v3-validated) lineage, packaged PhoneClaw-style for
// iOS, produce ENGLISH WAVE JSON on-device?

private struct WavePrompt: Decodable { let key: String; let systemPrompt: String; let userPrompt: String }
private struct WaveRef: Decodable { let key: String; let output: String }

final class ProbeTests: XCTestCase {

    private func resource(_ name: String, _ ext: String) throws -> Data {
        guard let url = Bundle.module.url(forResource: name, withExtension: ext) else {
            throw XCTSkip("\(name).\(ext) not bundled — run via ../run-probe.sh")
        }
        return try Data(contentsOf: url)
    }

    /// Host-identical combined prompt (eval/run.mjs:220).
    private func combined(_ p: WavePrompt) -> String {
        let sys = p.systemPrompt.replacingOccurrences(
            of: "\\s+$", with: "", options: .regularExpression)
        return "\(sys)\n\n\(p.userPrompt)"
    }

    private func hasCJK(_ s: String) -> Bool {
        for u in s.unicodeScalars {
            let v = u.value
            if (0x3040...0x30FF).contains(v) || (0x3400...0x4DBF).contains(v)
                || (0x4E00...0x9FFF).contains(v) || (0xAC00...0xD7AF).contains(v) { return true }
        }
        return false
    }

    /// Recognise WAVE reflection structure robustly: the fine-tune may emit
    /// valid content with key casing/format variants (journalPromptQuestion vs
    /// journalPromptquestion, nextSteps vs next_steps). We parse the first
    /// {...} block and check, case/format-insensitively, for the three WAVE
    /// fields with a non-trivial insight and a steps object — NOT exact host
    /// key spelling (that overfits and mismeasures a substantively-correct
    /// fine-tuned generation).
    private func structuralWAVE(_ text: String) -> Bool {
        guard let lo = text.firstIndex(of: "{"), let hi = text.lastIndex(of: "}"),
              lo < hi else { return false }
        guard let data = String(text[lo...hi]).data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return false }
        func norm(_ s: String) -> String {
            s.lowercased().filter { $0.isLetter || $0.isNumber }
        }
        let keys = Dictionary(obj.map { (norm($0.key), $0.value) },
                              uniquingKeysWith: { a, _ in a })
        guard let insight = keys["insight"] as? String,
              insight.count > 20 else { return false }            // real prose
        let hasJournal = keys.keys.contains { $0.hasPrefix("journalprompt") }
        let hasSteps = keys.keys.contains { $0.contains("nextstep") || $0.contains("steps") }
        return hasJournal && hasSteps
    }

    private func overlap(_ a: String, _ b: String) -> Double {
        func toks(_ s: String) -> Set<String> {
            Set(s.lowercased().split { !$0.isLetter && !$0.isNumber }.map(String.init))
        }
        let x = toks(a), y = toks(b)
        return (x.isEmpty || y.isEmpty) ? 0 : Double(x.intersection(y).count) / Double(x.union(y).count)
    }

    func testReflectionV0102DirectCAPI() throws {
        let envPath = ProcessInfo.processInfo.environment["WAVE_MODEL_PATH"]
        let filePath = (Bundle.module.url(forResource: "model-path", withExtension: "txt"))
            .flatMap { try? String(contentsOf: $0, encoding: .utf8) }?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard let modelPath = [envPath, filePath].compactMap({ $0 }).first(where: { !$0.isEmpty }) else {
            throw XCTSkip("No WAVE_MODEL_PATH / model-path.txt — run via ../run-probe.sh")
        }
        guard FileManager.default.fileExists(atPath: modelPath) else {
            throw XCTSkip("WAVE bundle not found at \(modelPath)")
        }

        let prompts = try JSONDecoder().decode([WavePrompt].self, from: resource("wave-prompts", "json"))
        let refs = try JSONDecoder().decode([WaveRef].self, from: resource("wave-outputs", "json"))
        guard let p = prompts.first(where: { $0.key == "reflection" }),
              let ref = refs.first(where: { $0.key == "reflection" }) else {
            return XCTFail("reflection prompt/ref missing")
        }
        let prompt = combined(p)

        // (v0.10.2's engine.cc doesn't define litert_lm_set_min_log_level —
        // it's declared in engine.h but lives in a TU outside the cc_binary
        // link closure; diagnostic-only, not needed. LiteRT still logs at its
        // default level, and the probe prints the generated text regardless.)

        // --- v0.10.2 canonical sequence (c/engine_test.cc) ---
        guard let settings = litert_lm_engine_settings_create(modelPath, "cpu", nil, nil) else {
            return XCTFail("litert_lm_engine_settings_create returned NULL")
        }
        defer { litert_lm_engine_settings_delete(settings) }
        litert_lm_engine_settings_set_max_num_tokens(settings, 4096)

        let t0 = Date()
        guard let engine = litert_lm_engine_create(settings) else {
            return XCTFail("litert_lm_engine_create returned NULL — engine/tokenizer/lineage")
        }
        defer { litert_lm_engine_delete(engine) }
        let loadMs = Int(Date().timeIntervalSince(t0) * 1000)

        guard let sc = litert_lm_session_config_create() else {
            return XCTFail("litert_lm_session_config_create returned NULL")
        }
        defer { litert_lm_session_config_delete(sc) }
        // v0.10.2's C-API explicit-sampler path is unimplemented
        // (sampler_factory.cc:593 → "Sampler type: N not implemented yet" for
        // the values reachable here). v0.10.2's OWN c/engine_test.cc
        // generation tests (GenerateContent / CreateSessionWithMaxOutputTokens)
        // never set sampler params — they use the model's compiled default
        // sampler + only set max output tokens. Mirror that supported path
        // exactly. (Determinism isn't required to answer "does v0.10.2 produce
        // English WAVE JSON"; the gates are language/structure/digit.)
        litert_lm_session_config_set_max_output_tokens(sc, 256)

        guard let session = litert_lm_engine_create_session(engine, sc) else {
            return XCTFail("litert_lm_engine_create_session returned NULL")
        }
        defer { litert_lm_session_delete(session) }

        let g0 = Date()
        let responses: OpaquePointer? = prompt.withCString { cstr in
            var input = InputData()
            input.type = kInputText
            input.data = UnsafeRawPointer(cstr)
            input.size = strlen(cstr)
            return litert_lm_session_generate_content(session, &input, 1)
        }
        let genMs = Int(Date().timeIntervalSince(g0) * 1000)
        guard let responses else {
            return XCTFail("litert_lm_session_generate_content returned NULL")
        }
        defer { litert_lm_responses_delete(responses) }

        let nCand = litert_lm_responses_get_num_candidates(responses)
        guard nCand > 0, let ctext = litert_lm_responses_get_response_text_at(responses, 0) else {
            return XCTFail("no response candidate (num=\(nCand))")
        }
        let out = String(cString: ctext)

        let english = !hasCJK(out)
        let structural = structuralWAVE(out)
        let hasDigit = out.contains { $0.isNumber }
        let ov = overlap(out, ref.output)

        let verdict: [String: Any] = [
            "ok": english && structural && hasDigit,
            "english": english, "structural": structural, "hasDigit": hasDigit,
            "overlapVsHostV3": (ov * 1000).rounded() / 1000,
            "chars": out.count, "loadMs": loadMs, "genMs": genMs,
            "lineage": "v0.10.2", "candidates": nCand,
            "output": out, "hostRef": ref.output,
        ]
        if let j = try? JSONSerialization.data(withJSONObject: verdict),
           let s = String(data: j, encoding: .utf8) {
            print("PROBE_RESULT::\(s)")
        }
        print("---- PROBE OUTPUT ----\n\(out)\n---- HOST v3 REF ----\n\(ref.output)\n----")

        XCTAssertFalse(out.isEmpty, "empty generation")
        XCTAssertTrue(english, "non-English/garbled — wrong lineage or broken tokenizer")
        XCTAssertTrue(structural, "not WAVE reflection JSON")
        XCTAssertTrue(hasDigit, "insight missing numeric endingIntensity")
    }
}
