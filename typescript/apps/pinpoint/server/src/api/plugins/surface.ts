/**
 * The two HTTP surfaces a handler can be mounted on: the canonical API and
 * the SPA's BFF (`/bff` prefix, `bff`-prefixed operationIds). Lets one
 * handler serve both without duplicating the route file.
 */
export interface Surface {
  readonly basePath: '' | '/bff';
  operationId(name: string): string;
}

export const CANONICAL_SURFACE: Surface = {
  basePath: '',
  operationId: (name) => name,
};

export const BFF_SURFACE: Surface = {
  basePath: '/bff',
  operationId: (name) => `bff${name.charAt(0).toUpperCase()}${name.slice(1)}`,
};
