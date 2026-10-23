import { describe, expect, test } from 'bun:test';
import { normalizeModelId, priceForModel } from '../src/features/quota/usage/pricing';
import {
  cacheMultiplier,
  cachedInputShare,
  parseUsageHistory,
  shiftDateKey,
  summarizeUsage,
  type UsageHistoryRow,
} from '../src/features/quota/usage/model';

const row = (overrides: Partial<UsageHistoryRow>): UsageHistoryRow => ({
  date: '2026-10-23',
  provider: 'codex',
  model: 'gpt-6.1-sol',
  inputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  ...overrides,
});

describe('pricing', () => {
  test('normalizes case, the [1m] marker and snapshot dates', () => {
    expect(normalizeModelId('Claude-Sonnet-4-6[1m]')).toBe('claude-sonnet-4-6');
    expect(normalizeModelId('claude-haiku-4-5-20251001')).toBe('claude-haiku-4-5');
    expect(priceForModel('claude-haiku-4-5-20251001')?.input).toBe(1);
  });

  test('bills Anthropic cache writes at 1.25x input and OpenAI cache writes at zero', () => {
    expect(priceForModel('claude-opus-5')?.cacheWrite).toBe(6.25);
    expect(priceForModel('gpt-6.1-sol')?.cacheWrite).toBe(0);
  });

  test('returns null for unknown models', () => {
    expect(priceForModel('mystery-model')).toBeNull();
  });
});

describe('parseUsageHistory', () => {
  test('drops malformed rows and keeps reasoning out of the totals', () => {
    const parsed = parseUsageHistory({
      started_at: '2026-10-01T00:00:00Z',
      days: [
        {
          date: '2026-10-23',
          provider: 'Codex',
          model: 'gpt-6.1-sol',
          source: 'proxy',
          input_tokens: 10,
          output_tokens: 5,
          reasoning_tokens: 3,
        },
        { date: 'yesterday', provider: 'codex' },
        { date: '2026-10-23' },
        null,
      ],
    });
    expect(parsed.startedAt).toBe('2026-10-01T00:00:00Z');
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({ provider: 'codex', inputTokens: 10, outputTokens: 5 });
  });

  test('tolerates a non-object payload', () => {
    expect(parseUsageHistory('nope')).toEqual({ startedAt: null, rows: [] });
  });
});

describe('summarizeUsage', () => {
  test('fills missing days with zero and ignores rows outside the range', () => {
    expect(shiftDateKey('2026-03-01', -1)).toBe('2026-02-28');
    const summary = summarizeUsage(
      [
        row({ date: '2026-10-21', outputTokens: 1_000_000 }),
        row({ date: '2026-09-01', outputTokens: 5 }),
      ],
      3,
      '2026-10-23'
    );
    expect(summary.dates).toEqual(['2026-10-21', '2026-10-22', '2026-10-23']);
    expect(summary.series[0].dailyTokens).toEqual([1_000_000, 0, 0]);
    expect(summary.series[0].dailyCost).toEqual([10, 0, 0]);
  });

  test('sums every source and computes cost, cache share and savings', () => {
    const summary = summarizeUsage(
      [
        // Claude Opus 5: 5 in / 25 out / 0.5 read / 6.25 write.
        row({
          provider: 'claude',
          model: 'claude-opus-5-20260101',
          inputTokens: 1_000_000,
          cacheReadTokens: 10_000_000,
          cacheWriteTokens: 1_000_000,
          outputTokens: 1_000_000,
        }),
        row({ provider: 'claude', model: 'claude-opus-5', outputTokens: 1_000_000 }),
      ],
      1,
      '2026-10-23'
    );
    const { totals } = summary;
    // 5 + 5 (reads) + 6.25 + 25 + 25 (second row).
    expect(totals.cost).toBeCloseTo(66.25);
    expect(totals.cacheSavings).toBeCloseTo(45);
    expect(totals.costWithoutCache).toBeCloseTo(111.25);
    expect(cacheMultiplier(totals)).toBeCloseTo(111.25 / 66.25);
    expect(totals.processed).toBe(14_000_000);
    expect(totals.cachedInput).toBe(11_000_000);
    expect(totals.uncachedInput).toBe(1_000_000);
    expect(totals.output).toBe(2_000_000);
    expect(cachedInputShare(totals)).toBeCloseTo(11 / 12);
  });

  test('counts tokens for unknown models without pricing them', () => {
    const summary = summarizeUsage(
      [
        row({ provider: 'xai', model: 'grok-9', inputTokens: 500 }),
        row({ provider: 'codex', model: 'gpt-6.1-sol', outputTokens: 1_000_000 }),
      ],
      1,
      '2026-10-23'
    );
    expect(summary.unpricedModels).toEqual(['grok-9']);
    expect(summary.totals.processed).toBe(1_000_500);
    expect(summary.series.map((item) => item.provider)).toEqual(['codex', 'xai']);
    expect(summary.series[1].cost).toBe(0);
  });

  test('has no multiplier when nothing was priced', () => {
    const summary = summarizeUsage([row({ model: 'unknown', inputTokens: 1 })], 1, '2026-10-23');
    expect(cacheMultiplier(summary.totals)).toBeNull();
  });
});
