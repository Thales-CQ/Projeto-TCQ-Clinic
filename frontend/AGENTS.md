# Frontend implementation rules

For every implementation or modification to the frontend, use the `$impeccable` skill and follow the current instructions in its `SKILL.md` and the reference for the applicable command. This applies to UI features, layout, navigation, components, styles, accessibility, responsive behavior, and frontend refinements.

## Required workflow

1. From the project root, run `/home/administrator/.agents/skills/impeccable/scripts/impeccable context --target <frontend-path>` once per session and use the resolved product/design context.
2. Read and follow the playbook for the requested or clearly implied Impeccable command. For ordinary work on an existing interface, inspect and preserve its established visual system and behavior.
3. Read `reference/craft-floor.md` immediately before editing UI files, as required by the skill.
4. Preserve the frontend's existing architecture, ownership boundaries, shared components, tokens, and styles unless the user approves a broader redesign.
5. After UI changes, run the Impeccable detector once when no automatic design hook is active, along with the relevant frontend tests and checks.
6. Do not repair stale Impeccable artifacts or change `PRODUCT.md`, `DESIGN.md`, or their sidecars as a side effect. Report drift and wait for an explicit request to refresh those artifacts.

User instructions and approved project scope take precedence over general design preferences. Do not add functionality or claim behavior that is not implemented.
