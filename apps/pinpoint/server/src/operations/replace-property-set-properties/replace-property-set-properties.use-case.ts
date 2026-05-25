import { generateTsid } from '@flowcatalyst/sdk';
import {
  Result,
  ScopeStore,
  UseCaseError,
  commitAggregate,
  type AggregateRegistryImpl,
  type Scope,
  type UnitOfWork,
} from '@pinpoint/framework';
import { PinpointPermission } from '@pinpoint/shared';

import {
  asLayerId,
  asPropertyId,
  asPropertySetId,
  PROPERTY_ID_PREFIX,
} from '../../domain/layers/ids.js';
import {
  MAX_PROPERTIES_PER_SET,
  PropertySet,
} from '../../domain/layers/property-set.js';
import { PropertySetPropertiesReplaced } from '../../domain/layers/events/property-set-properties-replaced.event.js';
import type { PropertySetRepository } from '../../domain/layers/property-set.repository.js';
import type { ReplacePropertySetPropertiesCommand } from './replace-property-set-properties.command.js';

export class ReplacePropertySetPropertiesUseCase {
  static readonly requiredPermission = PinpointPermission.LayersPropertySetUpdate;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly propertySets: PropertySetRepository,
  ) {}

  async execute(
    command: ReplacePropertySetPropertiesCommand,
  ): Promise<Result<PropertySetPropertiesReplaced>> {
    const scope = ScopeStore.require();

    if (!this.authorize(scope)) {
      return Result.failure(
        UseCaseError.authorization(
          'PERMISSION_DENIED',
          `Missing permission ${PinpointPermission.LayersPropertySetUpdate}.`,
        ),
      );
    }

    const layerId = asLayerId(command.layerId.trim());
    const propertySetId = asPropertySetId(command.propertySetId.trim());

    if (command.properties.length > MAX_PROPERTIES_PER_SET) {
      return Result.failure(
        UseCaseError.validation(
          'TOO_MANY_PROPERTIES',
          `A property set can have at most ${MAX_PROPERTIES_PER_SET} properties.`,
        ),
      );
    }

    const seen = new Set<string>();
    for (const p of command.properties) {
      const key = p.key.trim();
      if (key.length === 0) {
        return Result.failure(
          UseCaseError.validation('PROPERTY_KEY_REQUIRED', 'Property keys must not be empty.'),
        );
      }
      if (seen.has(key)) {
        return Result.failure(
          UseCaseError.businessRule('DUPLICATE_PROPERTY_KEY', `Duplicate property key '${key}'.`),
        );
      }
      seen.add(key);
    }

    const existing = await this.propertySets.findById(propertySetId);
    if (!existing) {
      return Result.failure(
        UseCaseError.notFound(
          'PROPERTY_SET_NOT_FOUND',
          `Property set '${propertySetId}' not found.`,
        ),
      );
    }
    if (existing.layerId !== layerId) {
      return Result.failure(
        UseCaseError.businessRule(
          'PROPERTY_SET_LAYER_MISMATCH',
          'Property set belongs to a different layer.',
        ),
      );
    }

    const now = new Date();
    const incoming = command.properties.map((p) => ({
      id: asPropertyId(`${PROPERTY_ID_PREFIX}_${generateTsid()}`),
      key: p.key.trim(),
      value: p.value,
    }));
    const updated = PropertySet.replaceProperties(existing, incoming, now);

    const event = new PropertySetPropertiesReplaced(scope, {
      propertySetId: updated.id,
      layerId: updated.layerId,
      properties: updated.properties.map((p) => ({ key: p.key, value: p.value })),
    });

    return commitAggregate(this.uow, this.registry, updated, event, command);
  }

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(ReplacePropertySetPropertiesUseCase.requiredPermission);
  }
}
