---
name: agent-loop
description: The AI agent subsystem - autonomy policy, tool execution, git facade, human-in-the-loop and budgets. Load when working on the agent loop, AI providers, or tool-call safety.
triggers:
  - "agent loop"
  - "autonomy"
  - "tool call"
  - "AI provider"
  - "human in the loop"
  - "HIL"
  - "tool exec"
edges:
  - target: context/architecture.md
    condition: when placing the agent stages in the end-to-end pipeline flow
  - target: context/conventions.md
    condition: when applying the Result and logging rules inside agent code
  - target: context/decisions.md
    condition: when understanding why a specific agent rule exists
# Add only nodes that embody the documented convention; do not ground examples broadly.
grounds_to: []
last_updated: 2026-10-22
mex:
  id: mx_01M5G2K48EA9GDQKPMTW9E5VHN
  type: component
  status: promoted
  revision: 3
  title: agent-loop
  relations:
    - type: related_to
      target: mx_01M5G2K6S4C1SVBP01Y76AECCC
      note: when placing the agent stages in the end-to-end pipeline flow
    - type: related_to
      target: mx_01M5G2K99N5VSF22C75FZCPNET
      note: when applying the Result and logging rules inside agent code
---

# Agent Loop

The agent subsystem is the deepest domain in this repo and the part with the most non-obvious rules. It lives in `packages/core/src/agent/` (tools, facades, lifecycle) and `packages/core/src/ai/` (provider clients and the loop itself).

## Autonomy Model

- **Hybrid autonomy** (ADR-006): mechanical fixes are applied automatically, generative bridging code is proposed and gated for human approval. The policy is *injected into the loop* rather than imported by it (ADR-030), so the loop has no opinion about which mode it is in.
- **The loop cap is the admission gate**; tokens and dollars are separate budgets, and raises are bounded (ADR-037).
- **Error classification is an explicit table**, not prefix rules (ADR-036).
- **The reasoning stream is strictly less load-bearing** than what it observes (ADR-035). Never let a reasoning string become a dependency.

## Tool Execution

- **Tools are made callable through `GitFacade` + `LoopConfig`** (ADR-021). The facade supplies content; imports are parsed from that supplied content, never via madge (ADR-022).
- **Tool validation runs on the raw arguments, before Zod** (ADR-031). Zod validates the shape; the raw-argument pass validates the safety.
- **The Git facade mutates the child stage, never the source repos** (ADR-038). This is the single most important safety rule in the subsystem.
- **`StagingFacade` is read-only** for child repo C (ADR-023).
- **Ranges are validated without being canonicalised** (ADR-024) — validation must not rewrite what the user wrote.
- **Plan and execute are separate phases, and rewrites are syntax-anchored** (ADR-026). Re-validate at apply time, and treat registration as append (ADR-027).

## Sandboxing and Verdicts

- **`SANDBOX_UNAVAILABLE` plus an injected `SandboxRunner`** (ADR-028). The loop never assumes Docker exists.
- **Timeout and cancellation are distinct outcomes** (ADR-029), and free-form answers are redacted.
- **A build verdict is never an error** (ADR-044): a failing build is a verdict, not a thrown failure. Never fabricate a verdict when the sandbox did not run.

## Human in the Loop

- **The agent lifecycle is a port, not a `state` column** (ADR-032).
- **The HIL queue owns its own tables**, and a question's answer is stored as that question's note (ADR-033). The queue lives in `packages/core/src/jobs/`, table `pipeline_jobs`.
- **The undo stack only records what can actually be reversed** (ADR-034). If it cannot be undone, it is not undoable.
- **Deleting, publishing, approving, rejecting, withdrawing, marking stale, repairing, taking, acknowledging or closing** a draft all require fresh explicit confirmation after a semantic preview. Skill activation is not approval.

## Providers

- **OpenRouter is the default hub** (ADR-005); OpenAI, Anthropic and Ollama are alternatives selected in `stitch.toml`.
- **Provider numbers are clamped** when they are collected into metrics (ADR-070), and cost/token tracking comes from the audited provider calls rather than from estimates.

## Where to Look

- `packages/core/src/agent/` — tools, facades, autonomy policy, lifecycle.
- `packages/core/src/ai/loop.ts` — the loop itself: admission gate, budgets, error classification.
- `packages/core/src/ai/` — provider clients (`openai.ts`, `anthropic.ts`, others).
- `packages/core/src/sandbox/` — the injected `SandboxRunner` and the `fallback.ts` path.
- `packages/core/src/jobs/queue.ts` — the HIL queue and its tables.
