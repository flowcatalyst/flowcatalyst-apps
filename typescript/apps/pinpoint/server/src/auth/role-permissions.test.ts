import { describe, expect, it } from 'vitest';
import { PinpointPermission } from '@pinpoint/shared';
import { ALL_CLIENTS_ATTRIBUTE } from '../domain/auth/partition-access.js';
import { ALL_PERMISSIONS_SET, requestTokenFromClaims } from './role-permissions.js';

const base = {
  sub: 'prn_1',
  roles: [] as string[],
  tier: null,
  clients: [] as string[],
  scopes: [] as string[],
  allApplications: false,
};

describe('requestTokenFromClaims', () => {
  it.each([
    ['clients *', { clients: ['*'] }],
    ['tier ANCHOR', { tier: 'ANCHOR' }],
    ['all_applications', { allApplications: true }],
    ['pinpoint:admin role', { roles: ['pinpoint:admin'] }],
  ])('marks %s as seeing every client, with every permission', (_label, overrides) => {
    const token = requestTokenFromClaims({ ...base, ...overrides });
    expect(token.attributes?.[ALL_CLIENTS_ATTRIBUTE]).toBe('true');
    expect(token.permissions).toBe(ALL_PERMISSIONS_SET);
  });

  it('limits everyone else to their scope permissions, without the all-clients flag', () => {
    const token = requestTokenFromClaims({
      ...base,
      clients: ['clt_acme'],
      scopes: [PinpointPermission.ReportingUsageRead, 'other:app:thing:read'],
    });
    expect(token.attributes).toBeUndefined();
    expect([...token.permissions!]).toEqual([PinpointPermission.ReportingUsageRead]);
  });
});
