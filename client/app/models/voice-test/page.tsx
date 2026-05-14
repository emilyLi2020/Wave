import { assertModelsEnabled } from "@/lib/models/guard";

import { VoiceTestClient } from "./voice-test-client";

export const dynamic = "force-dynamic";

export default function VoiceTestPage() {
  assertModelsEnabled();
  return <VoiceTestClient />;
}
