import { describe, expect, it } from 'vitest';
import {
  JOURNEY_STEPS,
  JOURNEY_STEP_TOTAL,
  stepByNumber,
  stepForState,
} from '../src/lib/journey/steps';
import { JOURNEY_STATES } from '../src/lib/journey/states';
import type { JourneyState } from '../src/lib/journey/states';

// ===========================================================================
// Phase E (legibility) — the patient-facing journey step indicator. steps.ts is a
// pure resolver (like cta.ts / start.ts): it drives no transition and gates nothing.
// These tests lock the labels + the state->step mapping so the "Step N of M" display
// stays coherent across the walk. The journey STATE machine is untouched (asserted).
// ===========================================================================

describe('JOURNEY_STEPS', () => {
  it('is a six-step forward walk with sequential 1-based numbers', () => {
    expect(JOURNEY_STEP_TOTAL).toBe(6);
    JOURNEY_STEPS.forEach((s, i) => {
      expect(s.n).toBe(i + 1);
      expect(s.label.length).toBeGreaterThan(0);
    });
  });

  it('carries no medicine / clinical term in any label', () => {
    const denied = /mounjaro|wegovy|ozempic|semaglutide|tirzepatide|estradiol|hrt|menopause/i;
    for (const s of JOURNEY_STEPS) expect(denied.test(s.label)).toBe(false);
  });
});

describe('stepByNumber', () => {
  it('returns the matching step and clamps out-of-range input', () => {
    expect(stepByNumber(1).label).toBe('Create your account');
    expect(stepByNumber(6).label).toBe('Treatment and delivery');
    expect(stepByNumber(0).n).toBe(1);
    expect(stepByNumber(99).n).toBe(6);
  });
});

describe('stepForState', () => {
  it('maps every journey state to a valid step (1..6), so the indicator never breaks', () => {
    for (const state of JOURNEY_STATES) {
      const n = stepForState(state as JourneyState);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(JOURNEY_STEP_TOTAL);
    }
  });

  it('groups the fine-grained states into the coarse walk', () => {
    expect(stepForState('registered')).toBe(1);
    expect(stepForState('id_pending')).toBe(2);
    expect(stepForState('id_verified')).toBe(3);
    expect(stepForState('intake_submitted')).toBe(4);
    expect(stepForState('screening_kit_sent')).toBe(4);
    expect(stepForState('results_ready')).toBe(4);
    expect(stepForState('in_review_queue')).toBe(5);
    expect(stepForState('consult_booked')).toBe(5);
    expect(stepForState('rx_issued')).toBe(6);
    expect(stepForState('delivered')).toBe(6);
  });
});
