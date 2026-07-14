import { describe, expect, it, vi } from 'vitest';
import { isFailure } from '@fulfil-go/framework';
import { createProcessRegistry, type ProcessCommands } from './process-registry.js';
import { standardDefinition } from './standard-definition.js';

// The definition passes command Results through untouched — any sentinel
// will do (Result.success() is UoW-restricted by the SDK on purpose).
const OK = { kind: 'success', value: {} };

function stubCommands(): ProcessCommands {
  return {
    registerPartPicking: { execute: vi.fn().mockResolvedValue(OK) },
    registerPartPicked: { execute: vi.fn().mockResolvedValue(OK) },
    registerPartFailed: { execute: vi.fn().mockResolvedValue(OK) },
    requestEpodProvisioning: { execute: vi.fn().mockResolvedValue(OK) },
  } as unknown as ProcessCommands;
}

describe('process registry', () => {
  const registry = createProcessRegistry([standardDefinition]);

  it('resolves the standard definition and rejects unknown stamps', () => {
    expect(registry.resolve('standard')).toBe(standardDefinition);
    expect(() => registry.resolve('acme-custom')).toThrow(/Unknown process definition/);
  });

  it('exposes the union of handled event types', () => {
    expect(registry.supportedEventTypes()).toContain('fulfil-go:pick:pick:claimed');
    expect(registry.supportedEventTypes()).toContain('fulfil-go:fulfilment:fulfilment:created');
  });
});

describe('standard definition', () => {
  const event = (eventType: string, payload: unknown = {}) => ({
    eventType,
    clientId: 'clt_1',
    fulfilmentId: 'ful_1',
    payload,
  });

  it('routes pick:claimed to register-part-picking with the event refs', async () => {
    const commands = stubCommands();
    await standardDefinition.handle(
      event('fulfil-go:pick:pick:claimed', { partId: 'fpt_1', pickerId: 'pkr_1' }),
      commands,
    );
    expect(commands.registerPartPicking.execute).toHaveBeenCalledWith({
      clientId: 'clt_1',
      fulfilmentId: 'ful_1',
      partId: 'fpt_1',
      pickerId: 'pkr_1',
    });
  });

  it('routes short-picked to register-part-picked with short=true', async () => {
    const commands = stubCommands();
    await standardDefinition.handle(
      event('fulfil-go:pick:pick:short-picked', {
        partId: 'fpt_1',
        pickerId: 'pkr_1',
        lineResults: [],
      }),
      commands,
    );
    expect(commands.registerPartPicked.execute).toHaveBeenCalledWith(
      expect.objectContaining({ short: true, packages: [], requiresCarOrLarger: false }),
    );
  });

  it('ACKs (business rule) events it has no reaction to', async () => {
    const result = await standardDefinition.handle(
      event('fulfil-go:something:else'),
      stubCommands(),
    );
    expect(isFailure(result)).toBe(true);
    if (isFailure(result)) {
      expect(result.error.code).toBe('EVENT_NOT_HANDLED_BY_DEFINITION');
      expect(result.error.type).toBe('business_rule');
    }
  });
});
