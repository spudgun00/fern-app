import { describe, expect, it } from 'vitest';
import {
  ALLOWED_TRANSITIONS,
  IllegalTransitionError,
  RX_ISSUED_PREDECESSORS,
  canTransition,
  transition,
} from '../src/lib/journey/machine';
import { JOURNEY_STATES, type JourneyState } from '../src/lib/journey/states';

describe('journey state machine', () => {
  it('allows every legal P0 transition in the map', () => {
    for (const from of JOURNEY_STATES) {
      for (const to of ALLOWED_TRANSITIONS[from]) {
        expect(transition(from, to)).toBe(to);
        expect(canTransition(from, to)).toBe(true);
      }
    }
  });

  it('throws on illegal transitions', () => {
    // A representative set of illegal transitions (skips and backwards moves).
    const illegal: Array<[JourneyState, JourneyState]> = [
      ['registered', 'intake_started'], // skips id_pending/id_verified
      ['registered', 'in_review_queue'],
      ['id_verified', 'approved'], // skips intake
      ['intake_submitted', 'approved'], // queue entry is not a decision
      ['in_review_queue', 'dispensing'],
      ['delivered', 'registered'], // no going back
      ['refused', 'rx_issued'], // terminal, and not a decision state
      ['active_member', 'rx_issued'],
    ];
    for (const [from, to] of illegal) {
      expect(canTransition(from, to)).toBe(false);
      expect(() => transition(from, to)).toThrow(IllegalTransitionError);
    }
  });

  it('throws on the same from->from no-op (not self-looping)', () => {
    expect(() => transition('registered', 'registered')).toThrow(IllegalTransitionError);
  });

  describe('HARD LINE: rx_issued is only reachable from approved or consult_done', () => {
    it('allows the two clinician-decision predecessors', () => {
      expect(transition('approved', 'rx_issued')).toBe('rx_issued');
      expect(transition('consult_done', 'rx_issued')).toBe('rx_issued');
    });

    it('throws for EVERY other state attempting to reach rx_issued', () => {
      const allowed = new Set<JourneyState>(RX_ISSUED_PREDECESSORS);
      for (const from of JOURNEY_STATES) {
        if (allowed.has(from)) continue;
        expect(
          canTransition(from, 'rx_issued'),
          `${from} must NOT reach rx_issued`,
        ).toBe(false);
        expect(() => transition(from, 'rx_issued')).toThrow(IllegalTransitionError);
      }
    });

    it('the only predecessors of rx_issued in the whole map are approved and consult_done', () => {
      const predecessors = JOURNEY_STATES.filter((from) =>
        ALLOWED_TRANSITIONS[from].includes('rx_issued'),
      ).sort();
      expect(predecessors).toEqual(['approved', 'consult_done']);
    });
  });
});
