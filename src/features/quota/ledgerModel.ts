/**
 * Ledger view model: one flat list of meters per credential, and per-provider
 * totals for the summary strip.
 *
 * Pure and React-free (the translator is passed in) so bun:test can pin the
 * aggregation rules. The provider bodies stay the source of truth for the full
 * card rendering; this only reads the remaining-capacity numbers they show.
 */

import { parseIsoToMs } from '@/utils/quota';
import type { QuotaProviderType } from './providers/types';

export interface LedgerMeter {
  /** Stable across credentials of one provider, so totals can group by it. */
  id: string;
  label: string;
  /** Remaining capacity in percent (0–100); null when the upstream did not say. */
  remaining: number | null;
  resetAtMs: number | null;
}

export interface LedgerSummaryLimit {
  id: string;
  label: string;
  /** Sum of remaining percent across loaded credentials that report this limit. */
  total: number;
  /** 100% per credential of the provider, loaded or not. */
  capacity: number;
  /** Soonest future reset among the credentials that report this limit. */
  soonestResetMs: number | null;
}

export interface LedgerProviderSummary {
  type: QuotaProviderType;
  credentialCount: number;
  loadedCount: number;
  /** The binding limit: lowest remaining ratio among the loaded credentials. */
  primary: LedgerSummaryLimit | null;
  others: LedgerSummaryLimit[];
  /** One entry per credential: remaining percent on the primary limit, null if unknown. */
  segments: (number | null)[];
}

export type LedgerTranslate = (key: string, params?: Record<string, unknown>) => string;

interface LabeledWindow {
  id?: string;
  label?: string;
  labelKey?: string;
  labelParams?: Record<string, string | number>;
  resetAtMs?: number | null;
}

const clampPercent = (value: number): number => Math.max(0, Math.min(100, value));

const remainingFromUsed = (used: unknown): number | null =>
  typeof used === 'number' && Number.isFinite(used) ? clampPercent(100 - used) : null;

const usableMs = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const windowLabel = (window: LabeledWindow, t: LedgerTranslate): string =>
  window.labelKey ? t(window.labelKey, window.labelParams) : (window.label ?? '');

/** Every limit one credential reports, in the order its card body lists them. */
export function collectLedgerMeters(
  type: QuotaProviderType,
  quota: unknown,
  t: LedgerTranslate
): LedgerMeter[] {
  const state = quota as { status?: string } | undefined;
  if (!state || state.status !== 'success') return [];

  if (type === 'claude' || type === 'codex') {
    const windows = (quota as { windows?: (LabeledWindow & { usedPercent: number | null })[] })
      .windows;
    return (windows ?? []).map((window, index) => ({
      id: window.id || `window-${index}`,
      label: windowLabel(window, t),
      remaining: remainingFromUsed(window.usedPercent),
      resetAtMs: usableMs(window.resetAtMs),
    }));
  }

  if (type === 'devin') {
    const windows = (
      quota as {
        windows?: { id: string; remainingPercent: number | null; resetAtMs: number | null }[];
      }
    ).windows;
    return (windows ?? []).map((window) => ({
      id: window.id,
      label: t(`devin_quota.${window.id}`),
      remaining:
        typeof window.remainingPercent === 'number' ? clampPercent(window.remainingPercent) : null,
      resetAtMs: usableMs(window.resetAtMs),
    }));
  }

  if (type === 'kimi') {
    const rows = (quota as { rows?: (LabeledWindow & { used: number; limit: number })[] }).rows;
    return (rows ?? []).map((row, index) => ({
      id: row.id || `row-${index}`,
      label: windowLabel(row, t),
      remaining:
        row.limit > 0
          ? clampPercent(Math.round(((row.limit - row.used) / row.limit) * 100))
          : row.used > 0
            ? 0
            : null,
      resetAtMs: usableMs(row.resetAtMs),
    }));
  }

  if (type === 'antigravity') {
    const groups = (
      quota as {
        groups?: {
          buckets?: {
            id: string;
            label: string;
            remainingFraction: number;
            resetAtMs?: number | null;
          }[];
        }[];
      }
    ).groups;
    return (groups ?? [])
      .flatMap((group) => group.buckets ?? [])
      .map((bucket) => ({
        id: bucket.id,
        label: bucket.label,
        remaining: Number.isFinite(bucket.remainingFraction)
          ? clampPercent(bucket.remainingFraction * 100)
          : null,
        resetAtMs: usableMs(bucket.resetAtMs),
      }));
  }

  if (type === 'xai') {
    const billing = (
      quota as {
        billing?: {
          mode?: string;
          periodType?: string;
          usagePercent: number | null;
          usedPercent: number | null;
          resetAtMs?: number | null;
          billingPeriodEnd?: string;
        } | null;
      }
    ).billing;
    if (!billing || billing.mode === 'paid-health') return [];
    if (billing.periodType === 'weekly') {
      return [
        {
          id: 'weekly',
          label: t('xai_quota.weekly_limit'),
          remaining: remainingFromUsed(billing.usagePercent),
          resetAtMs: usableMs(billing.resetAtMs),
        },
      ];
    }
    if (billing.usedPercent === null) return [];
    return [
      {
        id: 'monthly',
        label: t('xai_quota.monthly_credits'),
        remaining: remainingFromUsed(billing.usedPercent),
        resetAtMs: parseIsoToMs(billing.billingPeriodEnd),
      },
    ];
  }

  if (type === 'meta') {
    const windows = (
      quota as {
        data?: {
          windows?: {
            id: 'window' | 'weekly';
            usedPercent: number | null;
            resetAt?: number;
            durationMinutes?: number;
          }[];
        };
      }
    ).data?.windows;
    return (windows ?? []).map((window) => ({
      id: window.id,
      label:
        window.id === 'weekly'
          ? t('meta_quota.weekly')
          : window.durationMinutes
            ? t('meta_quota.window_duration', { minutes: window.durationMinutes })
            : t('meta_quota.window'),
      remaining: remainingFromUsed(window.usedPercent),
      resetAtMs: typeof window.resetAt === 'number' ? window.resetAt * 1000 : null,
    }));
  }

  return [];
}

/**
 * Fold one provider's credentials into the summary strip column.
 *
 * `metersByCredential` holds one entry per credential (empty when its quota is
 * not loaded yet). Capacity always counts every credential so a half-loaded
 * provider never looks fuller than it is.
 */
export function summarizeLedgerProvider(
  type: QuotaProviderType,
  metersByCredential: LedgerMeter[][],
  nowMs: number
): LedgerProviderSummary {
  const credentialCount = metersByCredential.length;
  const capacity = credentialCount * 100;
  const limits = new Map<string, LedgerSummaryLimit & { reporting: number }>();

  metersByCredential.forEach((meters) => {
    meters.forEach((meter) => {
      if (meter.remaining === null) return;
      const limit = limits.get(meter.id) ?? {
        id: meter.id,
        label: meter.label,
        total: 0,
        capacity,
        soonestResetMs: null,
        reporting: 0,
      };
      limit.total += meter.remaining;
      limit.reporting += 1;
      if (
        meter.resetAtMs !== null &&
        meter.resetAtMs > nowMs &&
        (limit.soonestResetMs === null || meter.resetAtMs < limit.soonestResetMs)
      ) {
        limit.soonestResetMs = meter.resetAtMs;
      }
      limits.set(meter.id, limit);
    });
  });

  const ranked = [...limits.values()];
  let primary: (typeof ranked)[number] | null = null;
  ranked.forEach((limit) => {
    // Ratio over the credentials that report it: a limit only one credential
    // has must not look healthier just because the others are silent.
    const ratio = limit.total / (limit.reporting * 100);
    const best = primary ? primary.total / (primary.reporting * 100) : Infinity;
    if (ratio < best) primary = limit;
  });

  const strip = (limit: LedgerSummaryLimit & { reporting: number }): LedgerSummaryLimit => ({
    id: limit.id,
    label: limit.label,
    total: limit.total,
    capacity: limit.capacity,
    soonestResetMs: limit.soonestResetMs,
  });

  const primaryId = (primary as (typeof ranked)[number] | null)?.id ?? null;
  return {
    type,
    credentialCount,
    loadedCount: metersByCredential.filter((meters) => meters.length > 0).length,
    primary: primary ? strip(primary) : null,
    // Most constrained first: the strip shows the first one and folds the rest.
    others: ranked
      .filter((limit) => limit.id !== primaryId)
      .sort((a, b) => a.total / a.reporting - b.total / b.reporting)
      .map(strip),
    segments: metersByCredential.map((meters) =>
      primaryId === null
        ? null
        : (meters.find((meter) => meter.id === primaryId)?.remaining ?? null)
    ),
  };
}

const XAI_SUPERGROK_LIMIT_CENTS = 15_000;
const XAI_SUPERGROK_HEAVY_LIMIT_CENTS = 150_000;

/**
 * Plan label shown under the credential name. Codex needs the full plan-tier
 * mapping, so its resolver is injected rather than duplicated here.
 */
export function resolveLedgerPlanLabel(
  type: QuotaProviderType,
  quota: unknown,
  t: LedgerTranslate,
  resolveCodexPlan: (planType: string | null) => string | null
): string | null {
  const state = quota as { status?: string } | undefined;
  if (!state || state.status !== 'success') return null;

  if (type === 'claude') {
    const planType = (quota as { planType?: string | null }).planType;
    return planType ? t(`claude_quota.${planType}`) : null;
  }
  if (type === 'codex') {
    return resolveCodexPlan((quota as { planType?: string | null }).planType ?? null);
  }
  if (type === 'antigravity') {
    const subscription = (
      quota as { subscription?: { tierName: string | null; plan: string | null } | null }
    ).subscription;
    return subscription?.tierName || subscription?.plan || null;
  }
  if (type === 'xai') {
    const billing = (
      quota as { billing?: { planLabel?: string; monthlyLimitCents: number | null } | null }
    ).billing;
    if (!billing) return null;
    if (billing.planLabel) return billing.planLabel;
    if (billing.monthlyLimitCents === XAI_SUPERGROK_LIMIT_CENTS)
      return t('xai_quota.plan_supergrok');
    if (billing.monthlyLimitCents === XAI_SUPERGROK_HEAVY_LIMIT_CENTS) {
      return t('xai_quota.plan_supergrok_heavy');
    }
    return null;
  }
  if (type === 'devin') return (quota as { plan?: string | null }).plan ?? null;
  if (type === 'meta') return (quota as { data?: { planName?: string } }).data?.planName ?? null;
  return null;
}
