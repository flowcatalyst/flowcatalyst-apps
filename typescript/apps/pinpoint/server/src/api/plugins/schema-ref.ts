import { Type, type Static, type TSchema } from '@sinclair/typebox';

/**
 * Typed `$ref` to a shared schema. The target must carry an `$id` and be
 * listed in `SHARED_SCHEMAS` (registered with `server.addSchema`), which is
 * what makes it resolvable by Fastify's validator/serializer and what turns
 * it into a named `components.schemas` entry in the OpenAPI document.
 *
 * The static type is preserved so `reply.send(...)` / `request.body` stay
 * checked exactly as with the inline schema.
 */
export function schemaRef<T extends TSchema>(schema: T) {
  const id = schema.$id;
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('schemaRef: schema must have an $id to be referenced');
  }
  return Type.Unsafe<Static<T>>(Type.Ref(`${id}#`));
}
