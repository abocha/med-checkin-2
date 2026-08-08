# Agent Handbook

This file is the repository-wide operating contract for coding agents. Keep it concise and reserve
it for durable conventions that apply across the project. More specific instructions in a nested
`AGENTS.md` or `AGENTS.override.md` take precedence for that subtree.

## Start Here

1. Locate every `AGENTS.md` or `AGENTS.override.md` that governs the working path, then read the
   root `README.md` and the nearest relevant package or subsystem README.
2. Follow the smallest documentation route that answers the question; do not load unrelated docs.
3. Inspect repository status before editing and preserve unrelated or user-owned changes. If the
   required edit overlaps those changes and cannot be made safely, stop and ask for direction.
4. Discover supported commands from manifests, task runners, and CI configuration; do not guess.

## Scope and Authorization

- Match the work to the request. A review, investigation, explanation, or plan is read-only unless
  the user also authorizes implementation.
- An implementation request authorizes the normal local edits and validation needed for that
  outcome, but not unrelated cleanup or external actions.
- Do not add or upgrade dependencies, intentionally rewrite lockfiles, or run untrusted install or
  lifecycle scripts unless that action is required by the requested change and its impact is clear.
- Do not create branches, commits, pushes, pull requests, releases, deployments, tickets, messages,
  or other external mutations unless the user explicitly requests them.
- Ask before destructive or difficult-to-reverse actions. Resolve exact targets first and prefer
  recoverable operations.
- Preserve the existing architecture and contracts unless changing them is part of the approved
  scope. Surface ambiguity instead of silently widening the task.

## Workflow

Use the lightest workflow consistent with risk:

- **Direct execution:** obvious, isolated, low-risk work with established patterns.
- **Targeted discipline:** contained bugs or behavior changes; reproduce the problem, add or update
  focused coverage, make the smallest correction, and verify it.
- **Design and planning:** unsettled behavior or material changes to architecture, authentication,
  authorization, persistent data, schemas, migrations, concurrency, privacy, security, or
  production. Document the proposed design and acceptance criteria in the task or an active plan,
  then obtain user approval before implementation.

When a task follows an approved plan, treat that plan as the scope and acceptance contract. Re-read
it after context compaction or a long interruption.

## Engineering Rules

- Do not hardcode, expose, log, or commit secrets or credentials.
- Do not silently change public APIs, schemas, environment variables, database contracts, file
  formats, or compatibility guarantees.
- Prefer existing patterns and the owning module's abstractions over parallel implementations.
- Keep changes focused. Avoid opportunistic refactors unless they are required for correctness.
- Do not weaken assertions, skip checks, or delete coverage merely to make validation pass.
- Update active documentation and examples when behavior or supported workflows change.
- Treat generated files according to their documented generation process; do not hand-edit them
  unless the repository explicitly requires it.

## Testing and Validation

- Start with the narrowest reliable check covering the changed behavior, then run the project's
  normal broader gate for shared contracts, cross-cutting changes, build or toolchain changes, or
  other work with meaningful integration risk. If that gate is skipped, state why in the handoff.
- Reproduce failures using the same command and environment when practical. Inspect the first fresh
  failure before changing code.
- Read existing logs and artifacts before rerunning expensive checks. Do not repeatedly rerun an
  unchanged failure without a new hypothesis or relevant state change.
- Validate behavior, not only formatting or compilation. Include regression coverage for bug fixes
  when a stable automated test is practical.
- Never claim success from stale or inferred results. In the final handoff, list the commands
  actually run, their outcomes, and any validation that remains CI- or environment-owned.

## Collaboration and Ownership

- The primary agent owns integration, repository accountability, and the final result.
- Delegation may be automatic when a matching custom role materially improves cost, context
  isolation, parallelism, or review quality. Do not delegate trivial work merely because a role exists.
  The primary agent remains responsible for task decomposition, integration, validation, and the
  final result.
- Give each delegated agent a bounded, non-overlapping question or responsibility, explicit file
  ownership for writes, and clear acceptance criteria.
- Preserve other agents' and users' concurrent work. Do not revert or overwrite changes merely
  because they are outside the current task.
- Verify delegated findings or edits in proportion to their risk before relying on them.

## Custom Project Roles

When the matching definitions exist under `.codex/agents/`, use the smallest role set that fits the
task. Role names, models, and sandbox settings do not grant additional authority; the user request,
active instruction chain, and parent task remain controlling.

### Delegation Routing Safety

- Select the actual registered custom role through the runtime's agent-role selector. A task name,
  prompt label, or natural-language role name is not sufficient evidence that the custom role was
  selected.
- Use a fresh child context (`fork_turns = "none"`) for heterogeneous model delegation unless the
  runtime explicitly guarantees equivalent isolation.
- Never silently substitute a generic/default agent or another model when the requested custom role
  cannot be selected. In particular, never substitute Sol, Terra, or an inherited parent
  configuration for `luna_implementer`.
- If named-role routing fails or is unavailable, either perform the work in the primary agent or
  report the routing failure.
- Do not claim that a child used a configured role, model, reasoning effort, or sandbox unless the
  runtime actually selected that role or provides corresponding execution metadata.

### Delegation Granularity

- Delegate by coherent ownership boundary, not mechanically by numbered plan task. One delegated
  worker may execute adjacent approved-plan tasks when they share the same subsystem, files,
  contracts, and implementation context, provided their acceptance criteria and validation remain
  distinct.
- Do not delegate a fresh explorer pass when an approved plan already contains a current, exact map
  of the relevant files, contracts, tests, and commands. Use `terra_explorer` when discovery is
  genuinely needed or implementation reveals drift from the plan.
- Prefer `luna_implementer` for bounded low-risk implementation. Give it the complete deliverable,
  assigned files or responsibility, acceptance criteria, and targeted validation rather than
  prescribing every mechanical edit and test cycle.
- Use `terra_workhorse` when related approved changes form one integration-heavy ownership boundary
  or require repository judgment beyond Luna's role.
- Use `sol_reviewer` only for a concrete exceptional-risk surface in the resulting diff. Ordinary
  coherent review belongs to `terra_reviewer`.

### Role Semantics

- **`luna_implementer`:** default delegated implementation role for a well-specified,
  pattern-following, low-risk change or a bounded implementation step from an approved plan. Prefer
  it over doing such non-trivial work in the Sol parent when the task can be handed off with explicit
  scope, acceptance criteria, and targeted validation. It must stop before architecture, security,
  authorization, privacy, data-integrity, concurrency, migration, public-contract, or production
  decisions.
- **`terra_explorer`:** read-only agent for broad multi-file tracing of entry points, execution
  paths, ownership, contracts, tests, configuration, and active documentation. It gathers evidence
  but does not choose architecture or implementation. Do not repeat its broad exploration in the
  primary context.
- **`terra_workhorse`:** opt-in workspace-writing agent for a user-authorized predetermined plan
  that requires repository and integration judgment. Assign plan scope, file or responsibility
  ownership, acceptance criteria, and required validation. It must stop when scope, contracts,
  ownership, or authorization become ambiguous.
- **`terra_reviewer`:** read-only reviewer for a coherent ordinary implementation batch with
  meaningful correctness, integration, regression, or test risk. It reports actionable findings
  and escalates exceptional-risk concerns instead of implementing fixes.
- **`sol_reviewer`:** read-only reviewer reserved for exceptional-risk changes involving security,
  authorization, privacy, data integrity, concurrency, retry or idempotency, dangerous migrations,
  or comparable consequences.

Keep review batches coherent by subsystem and risk rather than assigning one reviewer per checklist
item. Reuse the same reviewer for follow-up on the same implementation context when practical.

When executing an approved multi-step plan with delegated agents, follow `.codex/ORCHESTRATION.md`
and the repository-specific adapter in `.codex/PROJECT.md` when those files are present.

If the repository has no named SSOT, documentation router, or standard validation gate, treat the
active instruction chain, owning README, manifests, and CI configuration as the available authority.
Do not invent missing project policy; report the gap when it affects the task.

## Code Review Rules

- Prioritize correctness, security, data integrity, compatibility, and missing tests over style.
- Report actionable findings with precise file and line references, impact, and the condition that
  triggers the problem.
- Do not report mechanical formatting issues already enforced by repository tooling unless the
  tooling is missing or misconfigured.
- If there are no actionable findings, say so and identify any residual validation gaps.

## Definition of Done

- The requested outcome is complete without unapproved scope expansion.
- Relevant focused tests and proportionate broader validation have fresh evidence.
- Code, tests, and active documentation agree.
- Unrelated working-tree changes remain intact.
- The final handoff summarizes what changed, validation performed, and remaining risks or follow-up.

## Repository-Specific Additions

When adopting this file in another project, add only the durable details agents cannot reliably
discover, such as:

- the authoritative documentation entrypoint;
- canonical setup, test, lint, type-check, and build commands;
- package or service ownership boundaries;
- contract, migration, release, and production invariants;
- required pull-request metadata or review rules.

Put repeated subsystem-specific rules in a nested instruction file near that subsystem. Put one-off
requirements in the task or active plan, reusable workflows in skills, and deterministic enforcement
in scripts, hooks, linters, or CI.
