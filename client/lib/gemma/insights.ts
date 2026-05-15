import { generateWllamaInsights as generateGemmaInsights } from "@/lib/gemma/wllama-generators";
import { insightsPayloadSchema, type InsightsPayload } from "@/lib/prompts/schemas";
import type { Session } from "@/types/models";

type GemmaInsightsGenerator = typeof generateGemmaInsights;

export interface GenerateInsightsOptions {
  signal?: AbortSignal;
  /**
   * Optional generator override for tests and non-browser smoke checks.
   * Production callers use the local Gemma runtime import above.
   */
  generate?: GemmaInsightsGenerator;
}

export async function generateInsights(
  sessions: readonly Session[],
  options: GenerateInsightsOptions = {},
): Promise<InsightsPayload> {
  const generate = options.generate ?? generateGemmaInsights;
  const result = await generate(sessions, {
    maxNewTokens: 620,
    signal: options.signal,
  });

  const parsed = insightsPayloadSchema.safeParse(JSON.parse(result.text));
  if (!parsed.success) {
    throw new Error("Gemma returned insights in an unexpected shape");
  }

  return parsed.data;
}
