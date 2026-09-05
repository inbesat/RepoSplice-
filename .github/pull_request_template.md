<!-- Pull request template for repo-stitcher -->
<!-- Fields are required unless marked optional. Delete this comment before submitting. -->

## Summary

<!-- What does this PR do? Why? Link the phase(s) it advances: "Refs: P-XXX" -->

## Phase(s) Advanced

<!-- e.g. P-011, P-012 -->

## Type of Change

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to change)
- [ ] Documentation only
- [ ] Tooling / refactor (no behavior change)

## Packages Touched

- [ ] `packages/core` (inbesat review required)
- [ ] `packages/cli` (aradhy review required)
- [ ] `packages/web` (aradhy review required)
- [ ] root tooling
- [ ] `project-plans/`
- [ ] `.github/`

## Frozen Files

<!-- If you modified any of these, link the ADR: tsconfig.base.json, eslint.config.mjs,
     commitlint.config.cjs, vitest.config.ts, ARCHITECTURE.md, AGENTS.md, SECURITY.md -->

- [ ] No frozen files modified
- [ ] ADR linked: `project-plans/DECISIONS.md#<anchor>`

## Testing Performed

<!-- Required. List what you ran, what passed, what didn't. -->

- [ ] `bun run typecheck` → exit 0
- [ ] `bun run lint` → exit 0
- [ ] `bun test` → all pass
- [ ] `bun test --coverage` → thresholds met
- [ ] `bun run format:check` → exit 0
- [ ] `bunx changeset status` → exit 0
- [ ] Manual: <describe what you exercised by hand>

### Test Counts

- New tests: <count>
- Updated tests: <count>
- Coverage delta: <before> → <after>

## Changeset

<!-- Required for any user-facing change. See CONTRIBUTING.md §6 -->

- [ ] No changeset needed (internal/tooling/docs only)
- [ ] Changeset added: `.changeset/<name>.md`
  - Packages bumped: <e.g. @repo-stitcher/core: minor>
  - Summary: <one-liner>

## Screenshots (UI changes only)

<!-- Required for any visual change. Use ![]() to embed. -->

- [ ] Not applicable (no UI changes)
- [ ] Screenshots attached

## Risk + Rollback

<!-- What could go wrong? How do we roll back if it does? -->

- **Risk:** <low / medium / high — describe>
- **Blast radius:** <which users / jobs / data are affected>
- **Rollback plan:** <revert commit / feature flag / migration>

## Checklist

- [ ] Code follows `CONTRIBUTING.md` style guide
- [ ] New modules added to `ARCHITECTURE.md` (§3 module map)
- [ ] No new `console.log`; uses `logger`
- [ ] No new `throw` in core public APIs; uses `Result<T, StitchError>`
- [ ] No hardcoded secrets; `logger.redact` paths verified
- [ ] `PROGRESS.md` updated to mark phase(s) ✅
- [ ] Self-reviewed the diff
- [ ] Linked any related issues

## Reviewer Notes

<!-- Anything the reviewer should pay extra attention to. -->
