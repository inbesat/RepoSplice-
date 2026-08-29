# CONTEXT.md — Workspace Documentation Index
## repo-stitcher: Map of All Project-Level Context Files

**Version:** 1.0.0
**Purpose:** Single entry point for AI agents to locate every context file in this workspace.
**Last Updated:** 2026-08-30

---

## 📁 Folder: `project-plans/`

| File | Purpose | When to Read |
|------|---------|--------------|
| **PRD.md** | Product Requirements Document — source of truth for *what* and *why*. Contains core goal, personas, feature scope (MVP vs out-of-scope), edge cases, success metrics, release criteria. | **Always first** — defines product scope and boundaries. |
| **TECH_STACK.md** | Technical Blueprint — absolute reference for *tools, libraries, runtimes, versions*. Enforces no-guessing (e.g., Bun not Node, Elysia not Express, Zustand not Redux). | Before any code generation — dictates exact imports, APIs, patterns. |
| **ARCHITECTURE.md** | System Architecture — complete structural map: package boundaries, module responsibilities, data flow, DB schema, deployment, security, extension points. | Before implementing any module — shows where code lives and how it connects. |
| **MASTER_PLAN.md** | Phased Roadmap — 319 phases grouped into 15 epics across 4 waves, with owner (inbesat/aradhy), wave timing, and dependency order. | Before starting work — tells you *which phase* you're on and *what's next*. |
| **SECURITY.md** | Authorization & Security Boundaries — secrets management, auth rules, sandbox hardening, data validation, compliance. | Before touching auth, secrets, sandbox, or any external input handling. |
| **DECISIONS.md** | Architecture Decision Records (ADRs) — chronological log of technical choices, rejected alternatives, and rationale. Prevents re-litigation. | When you wonder "why X?" or consider changing a frozen decision. |
| **AGENTS.md** | AI Sub-Agent Instructions — concrete terminal commands, test coverage requirements, styling limits, self-validation loops. | When spawning a sub-agent or doing autonomous work. |
| **INTEGRATIONS.md** | Third-Party Integrations — interface docs, request/response shapes, endpoints for GitHub, Docker, OpenRouter, Anthropic, Ollama, ScanCode. | When implementing any external call. |
| **PROGRESS.md** | Dynamic Task Tracker — live checkboxes for Completed / Active / Blocked per phase. Session handoff artifact. | **Start of every session** — shows exactly where work left off. |
| **PHASES_DETAILED.md** | Elaborated Phase Context — every phase (P-000 to P-318) with detailed context, acceptance criteria, required MCPs/connectors, skills to invoke, and handoff notes. | When executing a specific phase — gives AI everything needed to complete it without guessing. |

---

## 📁 Folder: `packages/`

| Package | Key Files | Purpose |
|---------|-----------|---------|
| **core/** | `src/index.ts` (public API), `src/types/` (frozen contract), `src/*/` (modules) | All business logic; **zero UI deps**. |
| **cli/** | `src/index.ts` (commander), `src/commands/`, `src/ui/` (ink), `src/server/` (elysia) | Terminal interface + HTTP/WS server for Web UI. |
| **web/** | `src/pages/`, `src/components/`, `src/hooks/`, `src/store/` | React dashboard served by CLI server. |

---

## 📁 Folder: `docs/`

| File | Generated From |
|------|----------------|
| `api-reference.md` | `typedoc` on `core/src/index.ts` |
| `cli-reference.md` | `--help` output + command metadata |
| `config-reference.md` | Zod schemas in `core/src/config/schema.ts` |

---

## 🔄 How to Use This Index

1. **New Session Start** → Read `PROGRESS.md` → Read `MASTER_PLAN.md` for current phase → Read `PHASES_DETAILED.md` for that phase.
2. **Before Coding** → Read `TECH_STACK.md` (enforced stack) → Read `ARCHITECTURE.md` (module location) → Check `DECISIONS.md` for relevant ADRs.
3. **When Blocked** → Check `PRD.md` for scope → `SECURITY.md` for constraints → `INTEGRATIONS.md` for external API shapes.
4. **After Decision** → Append to `DECISIONS.md` with ADR format.
5. **Session End** → Update `PROGRESS.md` with completed/active/blocked.

---

## 🤖 For AI Agents: Quick-Start Checklist

```
☐ Read PROGRESS.md — know current state
☐ Read MASTER_PLAN.md — know phase + wave + owner
☐ Read PHASES_DETAILED.md#P-XXX — know exact context for your phase
☐ Read TECH_STACK.md — use exact imports/versions
☐ Read ARCHITECTURE.md — place code in correct module
☐ Check DECISIONS.md — don't reverse settled choices
☐ Follow AGENTS.md — run tests, lint, typecheck before done
☐ Update PROGRESS.md — mark phase complete
```

---

*End of CONTEXT.md. This file is the navigation hub — keep it current as files are added/renamed.*