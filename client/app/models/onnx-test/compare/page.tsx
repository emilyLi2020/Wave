import { assertModelsEnabled } from "@/lib/models/guard";

import { OnnxCompareClient } from "../compare-client";

export const dynamic = "force-dynamic";

export default function OnnxComparePage() {
  assertModelsEnabled();
  return <OnnxCompareClient />;
}
