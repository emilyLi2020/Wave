import { assertModelsEnabled } from "@/lib/models/guard";

import { SchemaProbeClient } from "./probe-client";

export const dynamic = "force-dynamic";

export default function WllamaSchemaProbePage() {
  assertModelsEnabled();
  return <SchemaProbeClient />;
}
