import { assertModelsEnabled } from "@/lib/models/guard";

import { MediaPipeFinetuneTestClient } from "./client";

export const dynamic = "force-dynamic";

export default function MediaPipeFinetuneTestPage() {
  assertModelsEnabled();
  return <MediaPipeFinetuneTestClient />;
}
