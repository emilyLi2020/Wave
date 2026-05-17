// Prize demo — stock Gemma 4 E2B on PhoneClaw's CLiteRTLM engine binary
// (the currently-shipping vendored GPU LiteRT-LM wrapper, ~50 tok/s on
// iPhone 17 Pro). Shares LiteRTStockScreenBase verbatim; only the intro
// copy differs from the from-source variant (LiteRTStockCustomScreen).

import React from "react";
import { Text } from "react-native";

import LiteRTStockScreenBase, {
  ENGINE_MAX_TOKENS,
  OUTPUT_MAX_TOKENS,
} from "@/screens/LiteRTStockScreenBase";

export default function LiteRTStockScreen() {
  return (
    <LiteRTStockScreenBase
      intro={
        <>
          Stock Gemma 4 E2B on LiteRT-LM (fork) running the three real WAVE
          surfaces — phase narration, a 3-turn check-in that fires the{" "}
          <Text style={{ fontWeight: "700" }}>endConversation</Text> tool call,
          and reflection — at the Wave#15-verified eng{ENGINE_MAX_TOKENS}/out
          {OUTPUT_MAX_TOKENS} config. One model load per surface (~75 s each).
        </>
      }
    />
  );
}
