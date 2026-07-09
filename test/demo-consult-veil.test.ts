import { describe, expect, it } from 'vitest';
import { readEnv } from '../src/lib/env';
import { consultJoinTarget } from '../src/lib/consult/veil';
import { RX_ISSUED_PREDECESSORS } from '../src/lib/journey/machine';

// ===========================================================================
// Demo consult "veil" (DEMO_CONSULT). A UI-only waiting-state behind a flag that
// is OFF by default, so the real Daily consult path is untouched. These tests
// pin the flag default, the pure Join-target resolver (the only branch that
// decides veil-vs-room), and re-assert the hard line is unmoved (the veil touches
// no journey/decision code).
// ===========================================================================

describe('DEMO_CONSULT flag', () => {
  it('is OFF by default and ON only when explicitly "true"', () => {
    expect(readEnv({ DEMO_CONSULT: undefined }).DEMO_CONSULT).toBe(false);
    expect(readEnv({ DEMO_CONSULT: 'false' }).DEMO_CONSULT).toBe(false);
    expect(readEnv({ DEMO_CONSULT: 'TRUE' }).DEMO_CONSULT).toBe(true);
    expect(readEnv({ DEMO_CONSULT: 'true' }).DEMO_CONSULT).toBe(true);
  });
});

describe('consultJoinTarget', () => {
  const room = 'https://ferncare.daily.co/room-abc?t=tok';

  it('routes Join to the veil only when the flag is on AND a room exists', () => {
    expect(consultJoinTarget(true, room)).toBe('/consult/veil');
  });

  it('leaves the real/mock room join URL untouched when the flag is off', () => {
    expect(consultJoinTarget(false, room)).toBe(room);
  });

  it('never routes to the veil when there is no room yet', () => {
    expect(consultJoinTarget(true, null)).toBeNull();
    expect(consultJoinTarget(false, null)).toBeNull();
  });
});

describe('HARD LINE', () => {
  it('rx_issued predecessors are unchanged by the veil', () => {
    expect([...RX_ISSUED_PREDECESSORS].sort()).toEqual(['approved', 'consult_done']);
  });
});
