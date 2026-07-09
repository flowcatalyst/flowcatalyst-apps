import { describe, expect, it } from 'vitest';
import { createPickerTokenService, PickerTokenError } from './picker-token.js';
import type { PickerAuthConfig } from './auth-config.js';

const config: PickerAuthConfig = {
  secret: 'unit-test-picker-secret-abcdefghijklmnopqrstuv',
  issuer: 'fulfilgo-pick-test',
  accessTtlSeconds: 900,
  refreshTtlSeconds: 3600,
  pinMaxAttempts: 5,
  lockoutMs: 300_000,
  usingDevSecret: false,
};

const svc = createPickerTokenService(config);

const input = {
  pickerId: 'pkr_abc',
  clientId: 'cli_1',
  storeRef: 'store-42',
  permissions: ['viewStorePicks'],
  deviceId: 'dev_9',
};

describe('picker-token', () => {
  it('issues + verifies an access token carrying the store-scoped claims', async () => {
    const session = await svc.issueSession(input);
    expect(session.expiresIn).toBe(900);
    const claims = await svc.verifyAccess(session.accessToken);
    expect(claims).toEqual({
      pickerId: 'pkr_abc',
      clientId: 'cli_1',
      storeRef: 'store-42',
      deviceId: 'dev_9',
      permissions: ['viewStorePicks'],
    });
  });

  it('verifies a refresh token (identity only, no perms)', async () => {
    const session = await svc.issueSession(input);
    const claims = await svc.verifyRefresh(session.refreshToken);
    expect(claims.pickerId).toBe('pkr_abc');
    expect(claims.storeRef).toBe('store-42');
    expect(claims.clientId).toBe('cli_1');
  });

  it('rejects a token used as the wrong type', async () => {
    const session = await svc.issueSession(input);
    await expect(svc.verifyRefresh(session.accessToken)).rejects.toBeInstanceOf(PickerTokenError);
    await expect(svc.verifyAccess(session.refreshToken)).rejects.toBeInstanceOf(PickerTokenError);
  });

  it('rejects a tampered token', async () => {
    const session = await svc.issueSession(input);
    const [h, p, s] = session.accessToken.split('.');
    await expect(svc.verifyAccess(`${h}.${p}x.${s}`)).rejects.toBeInstanceOf(PickerTokenError);
  });

  it('rejects a token minted by a different issuer', async () => {
    const other = createPickerTokenService({ ...config, issuer: 'someone-else' });
    const session = await other.issueSession(input);
    await expect(svc.verifyAccess(session.accessToken)).rejects.toBeInstanceOf(PickerTokenError);
  });

  it('isPickerToken routes only our issuer', async () => {
    const ours = await svc.issueSession(input);
    expect(svc.isPickerToken(ours.accessToken)).toBe(true);
    const other = createPickerTokenService({ ...config, issuer: 'someone-else' });
    const theirs = await other.issueSession(input);
    expect(svc.isPickerToken(theirs.accessToken)).toBe(false);
    expect(svc.isPickerToken('not-a-jwt')).toBe(false);
  });

  it('issues without a deviceId', async () => {
    const session = await svc.issueSession({ ...input, deviceId: undefined });
    const claims = await svc.verifyAccess(session.accessToken);
    expect(claims.deviceId).toBeNull();
  });
});
