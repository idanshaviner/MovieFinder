import { describe, it, expect } from 'vitest';
import {
  RECOMMEND_MONTHLY_CAP,
  RECOMMEND_DAILY_CAP,
  BETA_MAX_USERS_DEFAULT,
  EST_COST_PER_RECOMMEND_USD,
  MONTHLY_BUDGET_USD_DEFAULT,
} from './constants.ts';

/**
 * The cost model's central promise (PRD §8, docs/09 §13): the per-user caps ALONE bound monthly
 * spend to the budget, so the global kill-switch is only a backstop. If anyone bumps a cap, the
 * beta size, or the per-rec cost without re-checking, this test fails — keeping the guarantee honest.
 */
describe('budget self-enforcement invariant', () => {
  it('worst-case spend (every user maxes the monthly cap) stays within the budget', () => {
    const worstCaseSpend =
      RECOMMEND_MONTHLY_CAP * BETA_MAX_USERS_DEFAULT * EST_COST_PER_RECOMMEND_USD;
    expect(worstCaseSpend).toBeLessThanOrEqual(MONTHLY_BUDGET_USD_DEFAULT);
  });

  it('keeps a little headroom (≥5%) for token variance, not a razor-thin fit', () => {
    const worstCaseSpend =
      RECOMMEND_MONTHLY_CAP * BETA_MAX_USERS_DEFAULT * EST_COST_PER_RECOMMEND_USD;
    expect(worstCaseSpend).toBeLessThanOrEqual(MONTHLY_BUDGET_USD_DEFAULT * 0.95);
  });

  it('the daily cap never lets a single day exceed the monthly cap', () => {
    expect(RECOMMEND_DAILY_CAP).toBeLessThanOrEqual(RECOMMEND_MONTHLY_CAP);
  });
});
