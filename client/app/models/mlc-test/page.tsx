import { assertModelsEnabled } from "@/lib/models/guard";

import { MlcTestClient } from "./mlc-test-client";

export const dynamic = "force-dynamic";

export default function MlcTestPage() {
  assertModelsEnabled();
  return <MlcTestClient />;
}
