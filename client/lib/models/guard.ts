import { notFound } from "next/navigation";

/**
 * Env-flag gate for the dev-only /models surface (browser-runtime test
 * pages — MLC PR #3485, ONNX A/B, ONNX benchmark, voice loop). Every
 * route under client/app/models/ must call this first.
 *
 * Honors either NEXT_PUBLIC_MODELS_ENABLED or the older
 * NEXT_PUBLIC_TRAINING_ENABLED so existing dev setups keep working
 * after the rename from /training/*-test/* to /models/*.
 */
export function assertModelsEnabled(): void {
  if (!isModelsEnabled()) notFound();
}

export function isModelsEnabled(): boolean {
  return (
    process.env.NEXT_PUBLIC_MODELS_ENABLED === "true" ||
    process.env.NEXT_PUBLIC_TRAINING_ENABLED === "true"
  );
}
