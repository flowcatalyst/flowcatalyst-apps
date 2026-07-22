/**
 * TypeBox → Kotlin DTO generator for the native execution app.
 *
 * Reads the KOTLIN_CONTRACT registry (schema-by-Kotlin-name) and emits
 * kotlinx.serialization data classes to the Android project. Deliberately
 * supports only the JSON-Schema subset the contract uses — anything else
 * fails LOUDLY so a schema change can't silently emit a wrong type.
 *
 *   pnpm --filter @fulfil-go/shared gen:kotlin
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KOTLIN_CONTRACT, KOTLIN_TYPE_OVERRIDES } from '../src/api/kotlin-contract.js';

const OUT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../kotlin/fulfil-go-execution/app/src/main/java/io/flowcatalyst/fulfilgo/execution/api/Generated.kt',
);

interface JsonSchema {
  readonly type?: string;
  readonly anyOf?: readonly JsonSchema[];
  readonly const?: unknown;
  readonly items?: JsonSchema;
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly required?: readonly string[];
  readonly patternProperties?: unknown;
}

const names = new Map<object, string>();
// Type.Optional()/modifier wrappers CLONE schemas, so identity lookup alone
// misses wrapped references — fall back to structural equality (symbols
// don't survive JSON.stringify, so a clone stringifies identically).
const structuralNames = new Map<string, string>();
for (const [name, schema] of Object.entries(KOTLIN_CONTRACT)) {
  names.set(schema, name);
  const key = JSON.stringify(schema);
  if (!structuralNames.has(key)) structuralNames.set(key, name);
}

const queue: Array<[string, JsonSchema]> = Object.entries(KOTLIN_CONTRACT);
let usesJsonElement = false;

interface FieldType {
  readonly kotlin: string;
  readonly nullable: boolean;
  /** Union-of-literals doc, e.g. "'scan' | 'pin'". */
  readonly literals?: string;
}

function fail(context: string, schema: JsonSchema): never {
  throw new Error(`generate-kotlin: unsupported schema at ${context}: ${JSON.stringify(schema)}`);
}

function fieldType(schema: JsonSchema, owner: string, prop: string): FieldType {
  const named = names.get(schema as object) ?? structuralNames.get(JSON.stringify(schema));
  if (named !== undefined && named !== owner) return { kotlin: named, nullable: false };

  if (schema.anyOf) {
    const nonNull = schema.anyOf.filter((m) => m.type !== 'null');
    const nullable = nonNull.length !== schema.anyOf.length;
    if (nonNull.length > 0 && nonNull.every((m) => 'const' in m)) {
      return {
        kotlin: 'String',
        nullable,
        literals: nonNull.map((m) => `'${String(m.const)}'`).join(' | '),
      };
    }
    if (nonNull.length === 1) {
      const inner = fieldType(nonNull[0]!, owner, prop);
      return { ...inner, nullable: nullable || inner.nullable };
    }
    fail(`${owner}.${prop} (union)`, schema);
  }

  if ('const' in schema) return { kotlin: 'String', nullable: false };

  switch (schema.type) {
    case 'string':
      return { kotlin: 'String', nullable: false };
    case 'number':
      return { kotlin: 'Double', nullable: false };
    case 'integer':
      return { kotlin: 'Int', nullable: false };
    case 'boolean':
      return { kotlin: 'Boolean', nullable: false };
    case 'array': {
      if (!schema.items) fail(`${owner}.${prop} (array without items)`, schema);
      const inner = fieldType(schema.items, owner, prop);
      return { kotlin: `List<${inner.kotlin}${inner.nullable ? '?' : ''}>`, nullable: false };
    }
    case 'object': {
      if (schema.properties) {
        // Anonymous nested object → hoist under a synthesized name.
        const synthesized = owner + prop.charAt(0).toUpperCase() + prop.slice(1);
        names.set(schema as object, synthesized);
        structuralNames.set(JSON.stringify(schema), synthesized);
        queue.push([synthesized, schema]);
        return { kotlin: synthesized, nullable: false };
      }
      usesJsonElement = true;
      return { kotlin: 'JsonElement', nullable: false };
    }
    default:
      // TypeBox Unknown/Any emit no `type` — an opaque JSON value.
      usesJsonElement = true;
      return { kotlin: 'JsonElement', nullable: false };
  }
}

function emitClass(name: string, schema: JsonSchema): string {
  if (schema.type !== 'object' || !schema.properties) fail(name, schema);
  const required = new Set(schema.required ?? []);
  const lines: string[] = ['@Serializable', `data class ${name}(`];
  for (const [prop, sub] of Object.entries(schema.properties)) {
    const override = KOTLIN_TYPE_OVERRIDES[`${name}.${prop}`];
    const t = fieldType(sub, name, prop);
    const kotlin = override ?? t.kotlin;
    const optional = !required.has(prop);
    const nullable = optional || t.nullable;
    const suffix = nullable ? '? = null' : '';
    const doc = t.literals ? ` // ${t.literals}` : '';
    lines.push(`    val ${prop}: ${kotlin}${suffix},${doc}`);
  }
  lines.push(')');
  return lines.join('\n');
}

const classes: string[] = [];
const emitted = new Set<string>();
while (queue.length > 0) {
  const [name, schema] = queue.shift()!;
  if (emitted.has(name)) continue;
  emitted.add(name);
  classes.push(emitClass(name, schema));
}

const header = `// GENERATED FILE — DO NOT EDIT.
// Source of truth: @fulfil-go/shared src/api/kotlin-contract.ts
// Regenerate: pnpm --filter @fulfil-go/shared gen:kotlin
package io.flowcatalyst.fulfilgo.execution.api

import kotlinx.serialization.Serializable${usesJsonElement ? '\nimport kotlinx.serialization.json.JsonElement' : ''}
`;

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, `${header}\n${classes.join('\n\n')}\n`);
console.log(`generate-kotlin: wrote ${emitted.size} classes to ${OUT_PATH}`);
