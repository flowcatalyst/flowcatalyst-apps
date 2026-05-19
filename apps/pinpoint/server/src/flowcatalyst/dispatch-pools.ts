import { sync } from '@flowcatalyst/sdk';

export interface BuildPinpointDispatchPoolsConfig {
  readonly dispatchPoolCode: string;
}

export function buildPinpointDispatchPools(
  config: BuildPinpointDispatchPoolsConfig,
): readonly sync.DispatchPoolDefinition[] {
  return [
    {
      code: config.dispatchPoolCode,
      name: 'Pinpoint default dispatch pool',
    },
  ];
}
