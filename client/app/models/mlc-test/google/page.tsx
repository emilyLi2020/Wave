import { assertModelsEnabled } from "@/lib/models/guard";

import { GoogleTestClient } from "../google-test-client";

export const dynamic = "force-dynamic";

export default function GoogleTestPage() {
  assertModelsEnabled();
  return <GoogleTestClient />;
}
