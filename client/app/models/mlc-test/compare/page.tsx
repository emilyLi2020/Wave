import { assertModelsEnabled } from "@/lib/models/guard";

import { CompareClient } from "../compare-client";

export const dynamic = "force-dynamic";

export default function ComparePage() {
  assertModelsEnabled();
  return <CompareClient />;
}
