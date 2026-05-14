import { assertTrainingEnabled } from "@/lib/training/guard";

import { BaseTestClient } from "../base-test-client";

export const dynamic = "force-dynamic";

export default function BaseTestPage() {
  assertTrainingEnabled();
  return <BaseTestClient />;
}
