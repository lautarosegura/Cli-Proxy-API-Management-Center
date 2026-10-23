/**
 * Token usage history: response validation and per-provider daily aggregation.
 * Costs are client-side estimates from `pricing.ts`.
 */

import { priceForModel, type ModelPrice } from './pricing';

export type UsageHistoryRow = {
  date: string;
  provider: string;
  model: string;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
};

export type UsageHistory = {
  startedAt: string | null;
  rows: UsageHistoryRow[];
};

export type UsageSeries = {
  provider: string;
  cost: number;
  tokens: number;
  dailyCost: number[];
  dailyTokens: number[];
};

export type UsageTotals = {
  cost: number;
  /** Cost if every cache read had been billed as regular input. */
  costWithoutCache: number;
  cacheSavings: number;
  processed: number;
  cachedInput: number;
  uncachedInput: number;
  output: number;
};

export type UsageSummary = {
  dates: string[];
  series: UsageSeries[];
  totals: UsageTotals;
  unpricedModels: string[];
};

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PER_TOKEN = 1 / 1_000_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readCount = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;

/** Validates the `observability/usage/history` payload, dropping malformed rows. */
export function parseUsageHistory(raw: unknown): UsageHistory {
  if (!isRecord(raw)) return { startedAt: null, rows: [] };
  const startedAt = typeof raw.started_at === 'string' ? raw.started_at : null;
  const days = Array.isArray(raw.days) ? raw.days : [];
  const rows = days.flatMap((item): UsageHistoryRow[] => {
    if (!isRecord(item)) return [];
    const { date, provider, model } = item;
    if (typeof date !== 'string' || !DATE_KEY_PATTERN.test(date)) return [];
    if (typeof provider !== 'string' || !provider.trim()) return [];
    return [
      {
        date,
        provider: provider.trim().toLowerCase(),
        model: typeof model === 'string' ? model : '',
        inputTokens: readCount(item.input_tokens),
        cacheReadTokens: readCount(item.cache_read_tokens),
        cacheWriteTokens: readCount(item.cache_write_tokens),
        // reasoning_tokens is already part of output_tokens.
        outputTokens: readCount(item.output_tokens),
      },
    ];
  });
  return { startedAt, rows };
}

/** Local calendar date as YYYY-MM-DD, matching the backend's tz_offset bucketing. */
export function localDateKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Shifts a YYYY-MM-DD key by whole days; UTC math avoids DST gaps. */
export function shiftDateKey(key: string, deltaDays: number): string {
  const [year, month, day] = key.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return shifted.toISOString().slice(0, 10);
}

export const processedTokens = (row: UsageHistoryRow): number =>
  row.inputTokens + row.cacheReadTokens + row.cacheWriteTokens + row.outputTokens;

export function rowCost(row: UsageHistoryRow, price: ModelPrice): number {
  return (
    (row.inputTokens * price.input +
      row.cacheReadTokens * price.cacheRead +
      row.cacheWriteTokens * price.cacheWrite +
      row.outputTokens * price.output) *
    PER_TOKEN
  );
}

/**
 * Buckets rows into `days` consecutive dates ending at `today`, filling gaps
 * with zero. Rows from every `source` are summed. Unknown models cost 0 but
 * still count toward tokens.
 */
export function summarizeUsage(rows: UsageHistoryRow[], days: number, today: string): UsageSummary {
  const dates = Array.from({ length: days }, (_, index) => shiftDateKey(today, index - days + 1));
  const dateIndex = new Map(dates.map((date, index) => [date, index]));
  const byProvider = new Map<string, UsageSeries>();
  const unpriced = new Set<string>();
  const totals: UsageTotals = {
    cost: 0,
    costWithoutCache: 0,
    cacheSavings: 0,
    processed: 0,
    cachedInput: 0,
    uncachedInput: 0,
    output: 0,
  };

  for (const row of rows) {
    const index = dateIndex.get(row.date);
    if (index === undefined) continue;
    const tokens = processedTokens(row);
    if (tokens === 0) continue;

    let series = byProvider.get(row.provider);
    if (!series) {
      series = {
        provider: row.provider,
        cost: 0,
        tokens: 0,
        dailyCost: new Array<number>(days).fill(0),
        dailyTokens: new Array<number>(days).fill(0),
      };
      byProvider.set(row.provider, series);
    }

    const price = priceForModel(row.model);
    const cost = price ? rowCost(row, price) : 0;
    if (price) {
      const savings = row.cacheReadTokens * (price.input - price.cacheRead) * PER_TOKEN;
      totals.cacheSavings += savings;
      totals.costWithoutCache += cost + savings;
    } else {
      unpriced.add(row.model || '?');
    }

    series.cost += cost;
    series.tokens += tokens;
    series.dailyCost[index] += cost;
    series.dailyTokens[index] += tokens;

    totals.cost += cost;
    totals.processed += tokens;
    totals.cachedInput += row.cacheReadTokens + row.cacheWriteTokens;
    totals.uncachedInput += row.inputTokens;
    totals.output += row.outputTokens;
  }

  const series = [...byProvider.values()].sort(
    (a, b) => b.cost - a.cost || b.tokens - a.tokens || a.provider.localeCompare(b.provider)
  );
  return { dates, series, totals, unpricedModels: [...unpriced].sort() };
}

/** Share of input tokens served from cache (reads and writes), 0..1. */
export const cachedInputShare = (totals: UsageTotals): number => {
  const input = totals.cachedInput + totals.uncachedInput;
  return input > 0 ? totals.cachedInput / input : 0;
};

/** How many times cheaper caching made the run; null when nothing was priced. */
export const cacheMultiplier = (totals: UsageTotals): number | null =>
  totals.cost > 0 ? totals.costWithoutCache / totals.cost : null;
