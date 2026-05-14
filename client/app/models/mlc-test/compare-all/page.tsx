import { assertModelsEnabled } from "@/lib/models/guard";

import { CompareAllClient } from "./compare-all-client";

export const dynamic = "force-dynamic";

export default function CompareAllPage() {
  assertModelsEnabled();
  return <CompareAllClient />;
}
