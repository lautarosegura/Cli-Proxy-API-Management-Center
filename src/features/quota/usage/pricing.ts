/**
 * API list prices used to estimate what recorded token usage would cost if it
 * were billed at full API rates. USD per 1M tokens, standard tier, short context.
 *
 * Sources: OpenAI pricing page and Anthropic pricing page, fetched 2026-10-23.
 * Long-context surcharges and cache TTL differences (5m vs 1h writes) are ignored.
 * OpenAI does not bill cache writes; Anthropic bills them at 1.25x input.
 */

export type ModelPrice = {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
};

const openai = (input: number, cacheRead: number, output: number): ModelPrice => ({
  input,
  cacheRead,
  cacheWrite: 0,
  output,
});

const anthropic = (input: number, output: number, cacheRead: number): ModelPrice => ({
  input,
  cacheRead,
  cacheWrite: input * 1.25,
  output,
});

const PRICES: Record<string, ModelPrice> = {
  'gpt-6.1-sol': openai(2, 0.1, 10),
  'gpt-6-sol': openai(2, 0.2, 10),
  'gpt-6-astra': openai(10, 1, 50),
  'gpt-5.6-sol': openai(4, 0.4, 20),
  'gpt-5.6-luna': openai(0.2, 0.02, 1.2),
  'gpt-5.5': openai(5, 0.5, 30),
  'gpt-5.3-codex': openai(1.75, 0.175, 14),

  'claude-fable-5-1': anthropic(10, 50, 0.25),
  'claude-fable-5': anthropic(10, 50, 1),
  'claude-opus-5-5': anthropic(4, 20, 0.2),
  'claude-opus-5': anthropic(5, 25, 0.5),
  'claude-opus-4-8': anthropic(5, 25, 0.5),
  'claude-opus-4-7': anthropic(5, 25, 0.5),
  'claude-opus-4-6': anthropic(5, 25, 0.5),
  'claude-sonnet-5-5': anthropic(2, 10, 0.2),
  'claude-sonnet-5': anthropic(2, 10, 0.2),
  'claude-sonnet-4-6': anthropic(3, 15, 0.3),
  'claude-haiku-5-5': anthropic(0.1, 0.5, 0.01),
  'claude-haiku-4-5': anthropic(1, 5, 0.1),
};

/** Lowercase, then drop a trailing `[1m]` context marker and a `-YYYYMMDD` snapshot date. */
export const normalizeModelId = (model: string): string =>
  model
    .trim()
    .toLowerCase()
    .replace(/\[1m\]$/, '')
    .replace(/-\d{8}$/, '');

export const priceForModel = (model: string): ModelPrice | null =>
  PRICES[normalizeModelId(model)] ?? null;
