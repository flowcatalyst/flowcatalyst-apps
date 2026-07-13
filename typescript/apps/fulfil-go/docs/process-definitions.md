# Process definitions & client integration processes — design

Status: direction agreed with Andrew 2026-07-11; NOT built. Land the
registry refactor alongside the transport build (transport adds the timed
reaction bookkeeping that should live with the process definition).

## The idea

Coordination is already un-privileged: the process manager is a plain
platform subscriber whose inputs are events and whose outputs are commands
against each context's API. Platform subscriptions are **per client
(tenant)**, so different coordinators per client are natural. We split
coordination into two layers with different owners and blast radii:

```
commerce/order system (client's)
      │  order events (per-tenant subscription)
      ▼
┌─────────────────────────────┐   map / translate / enrich
│ CLIENT INTEGRATION PROCESS  │──────────────► create-fulfilment
│ (per tenant: intake + hooks)│◄────────────── fulfilment/pick/transport
└─────────────────────────────┘   public events (per-tenant subscription)
      │  client-specific hooks
      ▼
commerce callbacks ("complete" / "cancelled" on the order), notifications, …

┌─────────────────────────────┐
│ CORE PROCESS DEFINITION     │  domain policy: pick reactions, all-or-
│ (registry: standard, …)     │  nothing fan-out, when to request
└─────────────────────────────┘  transport, completion derivation triggers
```

## Layer 1 — core process definitions (inside fulfil-go)

- A **registry** of process definitions (`standard`, `<client>-custom`, …)
  — same pattern as transport provider adapters. Client config selects one;
  default `standard`.
- **Ownership stamp**: `processDefinition` is stamped on the fulfilment at
  creation (resolved from client config). Every reaction checks the stamp
  before acting. Changing a client's config migrates NEW fulfilments only —
  in-flight ones finish on their stamped definition. No cutover flag-day.
- **Contexts keep their invariants.** `register-part-picked`, READY
  derivation, version bumps stay fulfilment COMMANDS any definition invokes.
  A definition decides _whether and when_, never _how the aggregate
  transitions_. (Refactor note: today's deciders mix invariant commands and
  policy — split them when the registry lands; they're already thin
  event→command routers, so it's a reshape, not a rewrite.)
- The webhook route (delivery auth, idempotent ACK-on-state-guard, 500-for-
  retry) is shared infrastructure — definitions plug into it, never fork it.

## Layer 2 — client integration processes (the edge)

Andrew's example: the client's commerce system emits an order → the client
integration process (its own per-tenant subscription) maps/translates/
enriches → `create-fulfilment`. On `fulfilment:completed|failed|cancelled`
it calls BACK into the commerce system ("complete"/"cancel" the order) via
a client-specific integration.

Rules that keep this layer safe and swappable:

- It is an **anti-corruption layer**: it owns the CLIENT's vocabulary,
  credentials, endpoints and retry behaviour. It talks to fulfil-go ONLY
  through public commands and consumes ONLY public events — never internals.
- **Separate failure domain**: a commerce callback failing must never stall
  domain coordination. Callbacks are idempotent, keyed by externalRef;
  permanent failures dead-letter and surface in the management app.
- **Deployment**: start in-process (a per-client integration module
  registered like process definitions, hook config — callback URLs, auth —
  per client). Graduate a noisy/complex tenant to its own service without
  contract changes; per-tenant subscriptions make that a config move.

## Mermaid process flows per tenant

Requirement: for any client, render the end-to-end flow (order intake →
fulfilment → pick → transport → hooks/callbacks) as a mermaid diagram —
each client's hooks differ.

Approach: **declare reactions as data, bodies as code.** Definitions and
integration processes register through a small builder:

```ts
defineProcess('acme', (p) => {
  p.on('commerce:order:created').do('create-fulfilment', mapAcmeOrder);
  p.on('pick:failed').when('allOrNothing').do('cancel-siblings', 'fail-fulfilment');
  p.on('fulfilment:completed').hook('acme-commerce:complete-order');
});
```

The same registration structure drives BOTH the runtime router and a
diagram model — the mermaid generator walks registrations without executing
anything, so diagrams can't drift from behaviour. Output:

- CLI: `pnpm process:diagram --client <id>` → `docs/processes/<client>.mmd`
  (core definition + that client's integration hooks composed into one
  flowchart).
- Later: a management-app "Process" page per client rendering the same
  model live (mermaid renders client-side) — ops can see a tenant's flow
  without reading code.

## Staging & risk posture (revised with Andrew, 2026-07-12)

Robustness assessment: runtime safety is unchanged by the registry (same
webhook tx, state-guard idempotency, ACK/retry, optimistic locking — those
live in the commands, not the coordinator). The risks are DESIGN risks —
indirection and DSL lock-in — so the build is staged by risk:

**Registry v1 (build with transport — ~2 days, no flexibility cost):**

1. Ownership stamp (`process_definition` on fulfilment, default 'standard')
   - minimal client_settings home for the per-client selection.
2. Invariants/policy split: aggregate commands stay commands; deciders
   become thin policy modules.
3. Registry-as-SELECTOR: `processDefinition → coordinator module`, each
   module PLAIN TypeScript. Full per-client variance, zero DSL constraint.

**The `on/when/do` DSL + generated diagrams: DEFERRED until N≥2** — i.e.
until the second real process definition exists (first client integration
or EPOD-era variance). Rationale: a DSL designed against one process is a
guess; the first flow needing a missing verb (per-part fan-out, timed
step, compensation) forces ad-hoc DSL growth or code escape-hatches. Also
honest limits: with guards/commands as functions, generated diagrams are
truthful about STRUCTURE, not semantics. Guardrails when it is built:
typed literals (not strings), definitions may remain plain-code modules
(DSL optional per definition), one model → many renderers (mermaid;
railroad diagrams are a candidate second renderer for lifecycle-shaped
processes — no mermaid railroad type exists; tabatkins railroad-diagrams
SVG + platform diagramType support would be needed).

Until the DSL lands: mermaid stays hand-authored in docs/processes/ (drift
bounded by how rarely the standard flow changes), and the ACTIVITY LOG
(docs/activity-log.md) is the runtime truth — the recorded chain beats the
promised diagram in any incident.

Timed reactions (bookkeeping table + deadline sweep, the LastMileFulfilment
pattern) remain transport-scoped — first consumer is the STANDARD
service-level transport request; defer until that step exists.
