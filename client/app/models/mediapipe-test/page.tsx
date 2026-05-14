import { assertModelsEnabled } from "@/lib/models/guard";

import { MediaPipeTestClient } from "./client";

export const dynamic = "force-dynamic";

export default function MediaPipeTestPage() {
  assertModelsEnabled();
  return <MediaPipeTestClient />;
}
