import { env } from "../env";

/**
 * Provider-independent AI access. Daymark never runs a model itself: it sends a prompt to an external provider's HTTPS
 * API with a plain `fetch` (no SDK, so nothing heavy sits in memory) and gets text back. Anthropic is the default,
 * OpenAI is supported, and anything else is one small adapter. API keys come from the server environment only and
 * are never logged, returned or stored; neither is the prompt or the answer in any log line.
 */
export type AiRequest = { system: string; user: string; maxTokens: number };
export type AiResult = { text: string; provider: string; model: string; inputTokens: number | null; outputTokens: number | null };
export interface AiProvider { readonly name: string; readonly model: string; complete(req: AiRequest): Promise<AiResult> }

export class AiError extends Error {
  constructor(public code: "NOT_CONFIGURED" | "RATE_LIMITED" | "PROVIDER_ERROR" | "TIMEOUT" | "BAD_OUTPUT", message: string, public status?: number) { super(message); }
}

const TIMEOUT_MS = 60_000;
const RETRY_WAITS_MS = [1_000, 3_000];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Fetch = typeof fetch;

/** POST JSON with a timeout, and retry the failures that are worth retrying (429, 5xx, network). The key never appears in errors. */
async function postJson(f: Fetch, url: string, headers: Record<string, string>, body: unknown, waits = RETRY_WAITS_MS): Promise<unknown> {
  let last: AiError | null = null;
  for (let attempt = 0; attempt <= waits.length; attempt++) {
    if (attempt > 0) await sleep(waits[attempt - 1]);
    try {
      const res = await f(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (res.ok) return await res.json();
      const retryable = res.status === 429 || res.status >= 500;
      last = new AiError(res.status === 429 ? "RATE_LIMITED" : "PROVIDER_ERROR", `The AI provider answered with status ${res.status}.`, res.status);
      if (!retryable) throw last;
    } catch (e) {
      if (e instanceof AiError) { if (!(e.status === 429 || (e.status ?? 0) >= 500)) throw e; last = e; continue; }
      last = e instanceof Error && e.name === "TimeoutError" ? new AiError("TIMEOUT", "The AI provider took too long to answer.") : new AiError("PROVIDER_ERROR", "Couldn't reach the AI provider.");
    }
  }
  throw last ?? new AiError("PROVIDER_ERROR", "The AI provider failed.");
}

export function anthropicProvider(apiKey: string, model: string, f: Fetch = fetch, waits = RETRY_WAITS_MS, baseUrl = "https://api.anthropic.com"): AiProvider {
  return {
    name: "anthropic", model,
    async complete(req) {
      const j = (await postJson(f, `${baseUrl.replace(/\/$/, "")}/v1/messages`, { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        { model, max_tokens: req.maxTokens, system: req.system, messages: [{ role: "user", content: req.user }] }, waits)) as { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
      const text = (j.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
      if (!text) throw new AiError("BAD_OUTPUT", "The AI provider returned no text.");
      return { text, provider: "anthropic", model, inputTokens: j.usage?.input_tokens ?? null, outputTokens: j.usage?.output_tokens ?? null };
    },
  };
}

export function openaiProvider(apiKey: string, model: string, f: Fetch = fetch, waits = RETRY_WAITS_MS, baseUrl = "https://api.openai.com"): AiProvider {
  return {
    name: "openai", model,
    async complete(req) {
      const j = (await postJson(f, `${baseUrl.replace(/\/$/, "")}/v1/chat/completions`, { authorization: `Bearer ${apiKey}` },
        { model, max_tokens: req.maxTokens, messages: [{ role: "system", content: req.system }, { role: "user", content: req.user }] }, waits)) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      const text = j.choices?.[0]?.message?.content ?? "";
      if (!text) throw new AiError("BAD_OUTPUT", "The AI provider returned no text.");
      return { text, provider: "openai", model, inputTokens: j.usage?.prompt_tokens ?? null, outputTokens: j.usage?.completion_tokens ?? null };
    },
  };
}

export const DEFAULT_MODELS = { anthropic: "claude-sonnet-5-5", openai: "gpt-4o-mini" } as const;

let override: AiProvider | null = null;
/** Tests inject a fake here; production never calls this. */
export function setAiProviderForTests(p: AiProvider | null) { override = p; }

export function aiConfigured(): boolean {
  if (override) return true;
  const e = env();
  return e.AI_PROVIDER === "openai" ? !!e.OPENAI_API_KEY : !!e.ANTHROPIC_API_KEY;
}

export function getAiProvider(): AiProvider {
  if (override) return override;
  const e = env();
  const model = e.AI_MODEL || DEFAULT_MODELS[e.AI_PROVIDER];
  if (e.AI_PROVIDER === "openai") { if (!e.OPENAI_API_KEY) throw new AiError("NOT_CONFIGURED", "No AI provider key is configured on the server."); return openaiProvider(e.OPENAI_API_KEY, model, fetch, RETRY_WAITS_MS, e.OPENAI_BASE_URL); }
  if (!e.ANTHROPIC_API_KEY) throw new AiError("NOT_CONFIGURED", "No AI provider key is configured on the server.");
  return anthropicProvider(e.ANTHROPIC_API_KEY, model, fetch, RETRY_WAITS_MS, e.ANTHROPIC_BASE_URL);
}
