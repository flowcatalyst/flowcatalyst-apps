import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { sync } from '@flowcatalyst/sdk';

/**
 * Process documentation synced to the platform (workflow catalogue —
 * rendered as Mermaid there). Bodies live as `.mmd` files in
 * `apps/fulfil-go/docs/processes/` so they render on GitHub and stay
 * reviewable; this module just binds them to platform codes.
 *
 * Codes are 3-segment `<app>:<subdomain>:<process>` (event-type
 * convention). Hand-authored until the process-definition registry
 * (docs/process-definitions.md) generates diagrams from the builder.
 *
 * NOTE: reads happen at sync time via tsx from source — the path is
 * source-relative and not part of the runtime server.
 */
const PROCESS_DOCS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../docs/processes');

function processBody(file: string): string {
  return readFileSync(join(PROCESS_DOCS_DIR, file), 'utf8');
}

export function buildFulfilGoProcesses(): sync.ProcessDefinition[] {
  return [
    {
      code: 'fulfil-go:fulfilment:standard-fulfilment',
      name: 'Standard fulfilment',
      description:
        'End-to-end standard process: order intake → pick release (platform cron) → ' +
        'store picking (SSE + claim) → process-manager reactions → READY ' +
        '(all-or-nothing failure fan-out on the fail path). Transport leg lands next.',
      body: processBody('standard-fulfilment.mmd'),
      diagramType: 'mermaid',
      tags: ['fulfilment', 'process-manager'],
    },
    {
      code: 'fulfil-go:pick:pick-lifecycle',
      name: 'Pick lifecycle',
      description:
        'Pick aggregate state machine: platform-dispatched intake → claim (online-only) → ' +
        'picked / short-picked / failed, with actuals captured back onto the fulfilment part.',
      body: processBody('pick-lifecycle.mmd'),
      diagramType: 'mermaid',
      tags: ['pick', 'store'],
    },
  ];
}
