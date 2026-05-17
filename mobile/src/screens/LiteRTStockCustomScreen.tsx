// From-source engine variant — same harness, custom engine binary.
//
// Identical to the prize demo (LiteRTStockScreen) except the build is
// expected to carry the public-source engine dylib we built from
// LiteRT-LM v0.11.0 — `libLiteRTLMEngine.ios-arm64.v0.11.0.dylib`,
// swapped into the LiteRTLM xcframework per
// docs/upstream/HANDOFF-fromsource-engine-swap.md (step 2). There is no
// runtime switch: which binary runs is decided at build/sign time, so
// this screen exists to run the handoff's step-4 on-device acceptance
// (coherent output, tok/s vs the ~50 tok/s PhoneClaw baseline, MLDrift
// GPU cache present) against whatever engine the current build shipped.

import React from "react";
import { Text } from "react-native";

import LiteRTStockScreenBase, {
  ENGINE_MAX_TOKENS,
  OUTPUT_MAX_TOKENS,
} from "@/screens/LiteRTStockScreenBase";

export default function LiteRTStockCustomScreen() {
  return (
    <LiteRTStockScreenBase
      intro={
        <>
          From-source engine acceptance: the same three real WAVE surfaces —
          phase narration, a 3-turn check-in that fires the{" "}
          <Text style={{ fontWeight: "700" }}>endConversation</Text> tool call,
          and reflection — at the Wave#15-verified eng{ENGINE_MAX_TOKENS}/out
          {OUTPUT_MAX_TOKENS} config, but expecting the build to carry the
          custom{" "}
          <Text style={{ fontWeight: "700" }}>
            libLiteRTLMEngine v0.11.0
          </Text>{" "}
          dylib (HANDOFF step 2) instead of PhoneClaw&apos;s CLiteRTLM. Pass =
          coherent output + tok/s within range of the ~50 tok/s PhoneClaw
          baseline + MLDrift GPU cache present below. One model load per
          surface (~75 s each).
        </>
      }
    />
  );
}
