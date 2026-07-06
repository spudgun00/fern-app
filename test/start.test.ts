import { describe, expect, it } from 'vitest';
import { startDestination, postLoginDestination } from '../src/lib/start';

// ===========================================================================
// Phase C — the /start handoff resolver. Pure, unit-tested in isolation (like
// cta.ts). Proves: a cold visitor begins account creation, a returning visitor
// resumes their step (never a dead end), and purchase-off falls back to the waitlist.
// ===========================================================================

const WAITLIST = 'https://fern.care/#join';
const on = { purchaseEnabled: true, waitlistUrl: WAITLIST };
const off = { purchaseEnabled: false, waitlistUrl: WAITLIST };

describe('startDestination', () => {
  it('purchase OFF -> the waitlist (mirrors the entry-CTA switch), whatever the session', () => {
    expect(startDestination(off, { hasSession: false })).toBe(WAITLIST);
    expect(startDestination(off, { hasSession: true, role: 'patient', state: 'registered' })).toBe(WAITLIST);
  });

  it('COLD visitor (no session) -> begins account creation at /signup', () => {
    expect(startDestination(on, { hasSession: false })).toBe('/signup');
  });

  it('a clinician -> the console', () => {
    expect(startDestination(on, { hasSession: true, role: 'clinician' })).toBe('/clinician');
  });

  it('a returning patient resumes at their current onboarding step (never a dead end)', () => {
    expect(startDestination(on, { hasSession: true, role: 'patient', state: 'registered' })).toBe('/account/profile');
    expect(startDestination(on, { hasSession: true, role: 'patient', state: 'id_pending' })).toBe('/account/verify');
    expect(startDestination(on, { hasSession: true, role: 'patient', state: 'id_verified' })).toBe('/intake');
    // Anyone past intake lands on their hub, not a mid-flow page.
    expect(startDestination(on, { hasSession: true, role: 'patient', state: 'intake_submitted' })).toBe('/dashboard');
    expect(startDestination(on, { hasSession: true, role: 'patient', state: 'delivered' })).toBe('/dashboard');
    expect(startDestination(on, { hasSession: true, role: 'patient', state: null })).toBe('/dashboard');
  });
});

describe('postLoginDestination (authenticated landing — never the dev harness)', () => {
  it('a clinician lands on the console', () => {
    expect(postLoginDestination({ role: 'clinician', state: null })).toBe('/clinician');
  });

  it('a patient resumes at their current onboarding step', () => {
    expect(postLoginDestination({ role: 'patient', state: 'registered' })).toBe('/account/profile');
    expect(postLoginDestination({ role: 'patient', state: 'id_pending' })).toBe('/account/verify');
    expect(postLoginDestination({ role: 'patient', state: 'id_verified' })).toBe('/intake');
    expect(postLoginDestination({ role: 'patient', state: 'intake_submitted' })).toBe('/dashboard');
    expect(postLoginDestination({ role: 'patient', state: 'delivered' })).toBe('/dashboard');
  });

  it('never routes to the dev harness or the waitlist (no purchase gate)', () => {
    for (const state of ['registered', 'id_verified', 'delivered', null] as const) {
      const dest = postLoginDestination({ role: 'patient', state });
      expect(dest.startsWith('/')).toBe(true); // an in-app path, not an external waitlist URL
      expect(dest).not.toContain('/dev/');
    }
  });
});
