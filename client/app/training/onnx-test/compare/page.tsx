import { assertTrainingEnabled } from "@/lib/training/guard";

import { OnnxCompareClient } from "../compare-client";

export const dynamic = "force-dynamic";

export default function OnnxComparePage() {
  assertTrainingEnabled();
  return <OnnxCompareClient />;
}
