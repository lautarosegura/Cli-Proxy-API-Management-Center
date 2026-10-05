/**
 * Ledger meters per credential and the per-provider summary strip totals.
 */

import { describe, expect, test } from 'bun:test';
import {
  collectLedgerMeters,
  resolveLedgerPlanLabel,
  summarizeLedgerProvider,
  type LedgerMeter,
} from '@/features/quota/ledgerModel';

const NOW = new Date(2026, 8, 11, 12).getTime();
const HOUR = 3_600_000;
const t = (key: string) => `t:${key}`;

const claude = (fable: number | null, fiveHour: number, sevenDay: number, resetH = 24) => ({
  status: 'success',
  planType: 'plan_max',
  windows: [
    {
      id: 'five-hour',
      label: '5h',
      labelKey: 'claude_quota.five_hour',
      usedPercent: 100 - fiveHour,
      resetLabel: '',
      resetAtMs: null,
    },
    {
      id: 'seven-day',
      label: '7d',
      labelKey: 'claude_quota.seven_day',
      usedPercent: 100 - sevenDay,
      resetLabel: '',
      resetAtMs: NOW + resetH * HOUR,
    },
    {
      id: 'seven-day-fable',
      label: 'Fable',
      labelKey: 'claude_quota.seven_day_fable',
      usedPercent: fable === null ? null : 100 - fable,
      resetLabel: '',
      resetAtMs: NOW + resetH * HOUR,
    },
  ],
});

describe('collectLedgerMeters', () => {
  test('reads remaining percent and translated labels for Claude', () => {
    const meters = collectLedgerMeters('claude', claude(58, 100, 79), t);
    expect(meters.map((meter) => [meter.id, meter.label, meter.remaining])).toEqual([
      ['five-hour', 't:claude_quota.five_hour', 100],
      ['seven-day', 't:claude_quota.seven_day', 79],
      ['seven-day-fable', 't:claude_quota.seven_day_fable', 58],
    ]);
  });

  test('returns nothing until the quota has loaded', () => {
    expect(collectLedgerMeters('claude', { status: 'idle', windows: [] }, t)).toEqual([]);
    expect(collectLedgerMeters('codex', undefined, t)).toEqual([]);
  });

  test('converts Kimi used/limit and Antigravity fractions', () => {
    const kimi = collectLedgerMeters(
      'kimi',
      {
        status: 'success',
        rows: [{ id: 'weekly', labelKey: 'kimi_quota.weekly_limit', used: 25, limit: 100 }],
      },
      t
    );
    expect(kimi[0].remaining).toBe(75);

    const antigravity = collectLedgerMeters(
      'antigravity',
      {
        status: 'success',
        groups: [
          { id: 'g', label: 'G', buckets: [{ id: 'b', label: 'Gemini', remainingFraction: 0.4 }] },
        ],
      },
      t
    );
    expect(antigravity[0]).toMatchObject({ id: 'b', label: 'Gemini', remaining: 40 });
  });
});

describe('summarizeLedgerProvider', () => {
  const meters = (quota: unknown): LedgerMeter[] => collectLedgerMeters('claude', quota, t);

  test('picks the most constrained limit and sums it across credentials', () => {
    const summary = summarizeLedgerProvider(
      'claude',
      [
        meters(claude(58, 100, 79, 25)),
        meters(claude(100, 100, 100, 96)),
        meters(claude(51, 99, 75, 11)),
      ],
      NOW
    );
    expect(summary.primary).toMatchObject({ id: 'seven-day-fable', total: 209, capacity: 300 });
    expect(summary.primary?.soonestResetMs).toBe(NOW + 11 * HOUR);
    expect(summary.segments).toEqual([58, 100, 51]);
    // Remaining limits follow, most constrained first.
    expect(summary.others.map((limit) => [limit.id, limit.total])).toEqual([
      ['seven-day', 254],
      ['five-hour', 299],
    ]);
  });

  test('keeps capacity for unloaded credentials and leaves their segment empty', () => {
    const summary = summarizeLedgerProvider('claude', [meters(claude(80, 100, 90)), []], NOW);
    expect(summary.credentialCount).toBe(2);
    expect(summary.loadedCount).toBe(1);
    expect(summary.primary).toMatchObject({ total: 80, capacity: 200 });
    expect(summary.segments).toEqual([80, null]);
  });

  test('has no primary limit when nothing is loaded', () => {
    const summary = summarizeLedgerProvider('xai', [[]], NOW);
    expect(summary.primary).toBeNull();
    expect(summary.others).toEqual([]);
    expect(summary.segments).toEqual([null]);
  });

  test('ignores resets already in the past', () => {
    const summary = summarizeLedgerProvider('claude', [meters(claude(50, 100, 100, -2))], NOW);
    expect(summary.primary?.soonestResetMs).toBeNull();
  });
});

describe('resolveLedgerPlanLabel', () => {
  test('uses provider-specific plan sources', () => {
    const codexResolver = (planType: string | null) => (planType ? `codex:${planType}` : null);
    expect(resolveLedgerPlanLabel('claude', claude(1, 1, 1), t, codexResolver)).toBe(
      't:claude_quota.plan_max'
    );
    expect(
      resolveLedgerPlanLabel('codex', { status: 'success', planType: 'pro' }, t, codexResolver)
    ).toBe('codex:pro');
    expect(
      resolveLedgerPlanLabel(
        'xai',
        { status: 'success', billing: { monthlyLimitCents: 15_000 } },
        t,
        codexResolver
      )
    ).toBe('t:xai_quota.plan_supergrok');
    expect(
      resolveLedgerPlanLabel('kimi', { status: 'success', rows: [] }, t, codexResolver)
    ).toBeNull();
  });
});
