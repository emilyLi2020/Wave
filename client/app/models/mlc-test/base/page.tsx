import { assertModelsEnabled } from "@/lib/models/guard";

import { BaseTestClient } from "../base-test-client";

export const dynamic = "force-dynamic";

export default function BaseTestPage() {
  assertModelsEnabled();
  return <BaseTestClient />;
}
