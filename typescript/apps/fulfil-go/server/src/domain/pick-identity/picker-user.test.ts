import { describe, expect, it } from 'vitest';
import { PickerUser } from './picker-user.js';
import type { PickerUserId } from './ids.js';

const NOW = new Date('2026-07-09T10:00:00Z');

function make(): PickerUser {
  return PickerUser.create({
    id: 'pkr_x' as PickerUserId,
    clientId: 'cli_1',
    storeRef: 'store-1',
    displayName: 'Thandi',
    staffCode: 'T01',
    primaryAuthMethod: 'pin',
    pinHash: 'hash',
    now: NOW,
  });
}

describe('PickerUser', () => {
  it('creates active with cleared lockout at version 1', () => {
    const p = make();
    expect(p.status).toBe('active');
    expect(p.failedPinAttempts).toBe(0);
    expect(p.lockedUntil).toBeNull();
    expect(p.version).toBe(1);
  });

  it('registerFailedPin increments below the cap without locking', () => {
    const p = PickerUser.registerFailedPin(make(), NOW, 5, 300_000);
    expect(p.failedPinAttempts).toBe(1);
    expect(p.lockedUntil).toBeNull();
    expect(PickerUser.isLocked(p, NOW)).toBe(false);
  });

  it('locks and resets the counter on hitting the cap', () => {
    let p = make();
    for (let i = 0; i < 5; i += 1) p = PickerUser.registerFailedPin(p, NOW, 5, 300_000);
    expect(p.lockedUntil).not.toBeNull();
    expect(p.failedPinAttempts).toBe(0);
    expect(PickerUser.isLocked(p, NOW)).toBe(true);
    // Lock expires after the window.
    expect(PickerUser.isLocked(p, new Date(NOW.getTime() + 300_001))).toBe(false);
  });

  it('clearLockout resets failure state', () => {
    let p = PickerUser.registerFailedPin(make(), NOW, 5, 300_000);
    p = PickerUser.clearLockout(p, NOW);
    expect(p.failedPinAttempts).toBe(0);
    expect(p.lockedUntil).toBeNull();
  });
});
