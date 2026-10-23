import { apiClient } from './client';

const USAGE_HISTORY_TIMEOUT_MS = 15 * 1000;

export const usageHistoryApi = {
  /**
   * Daily token usage per provider and model. `tzOffsetMinutes` is minutes east
   * of UTC and decides which calendar day each record lands in.
   */
  getHistory: (days: number, tzOffsetMinutes: number) =>
    apiClient.get<unknown>('/observability/usage/history', {
      params: { days, tz_offset: tzOffsetMinutes },
      timeout: USAGE_HISTORY_TIMEOUT_MS,
    }),
};
