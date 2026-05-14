import { assertTrainingEnabled } from "@/lib/training/guard";

import { CompareClient } from "../compare-client";

export const dynamic = "force-dynamic";

export default function ComparePage() {
  assertTrainingEnabled();
  return <CompareClient />;
}
