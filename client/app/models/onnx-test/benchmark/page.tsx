import { assertModelsEnabled } from "@/lib/models/guard";

import { OnnxBenchmarkClient } from "../benchmark-client";

export const dynamic = "force-dynamic";

export default function OnnxBenchmarkPage() {
  assertModelsEnabled();
  return <OnnxBenchmarkClient />;
}
