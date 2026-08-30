<div align="center">

# 🧬 RepoSplice

**Multi-Repo Composition Engine with AI-Augmented Stitching**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6+-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-1.1+-fbf0df?logo=bun&logoColor=000)](https://bun.sh)
[![Status](https://img.shields.io/badge/Status-In%20Development-orange)]()

*Take two (or more) Git repositories and produce a **new, runnable, history-preserving** child repository — intelligently, not by naive file copying.*

</div>

---

## 🤔 The Problem

You need to combine code from multiple repositories into one. Today, that means:

- Manual `git subtree` or `git filter-repo` gymnastics
- Dependency hell when merging `package.json` / `pyproject.toml` / `Cargo.toml`
- Broken imports, missing configs, conflicting entrypoints
- Zero license visibility — shipping GPL code into an MIT project
- `git blame` and history lost forever
- Hours (or days) of manual glue work

## ✅ The Solution

**RepoSplice** automates the entire multi-repo merge workflow:

```
stitch merge --from A:src/auth --from B:src/dashboard --out C
```

In minutes, you get a **repo C** that compiles, runs, passes tests, and has clear legal provenance — ready to ship.

---

## ✨ Key Features

| Feature | Description |
|---------|-------------|
| 🎯 **Smart File Selection** | Select exactly the files you need — RepoSplice automatically resolves the full dependency closure (transitive imports). |
| 🔀 **History-Preserving Merge** | Uses `git filter-repo` + subtree merge so `git log` and `git blame` work perfectly in the output repo. |
| 📦 **Manifest Merge** | Parses and unions `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod` — flags semver collisions and suggests resolutions. |
| ⚖️ **License Compliance** | Scans declared licenses, normalizes to SPDX, checks compatibility (permissive vs copyleft), and blocks risky combinations. |
| 🤖 **AI Agent Loop** | An AI loop auto-fixes mechanical issues (deps, configs, file moves) and proposes new bridging code for human approval. |
| 🐳 **Sandbox Verification** | Spins up Docker containers to `install → build → test` the merged repo — green means it works. |
| 📜 **Full Provenance** | Generates `CREDITS.md`, CycloneDX SBOM, and git notes — every file in C is traceable to its origin. |
| 🖥️ **CLI + Web UI** | Full-featured CLI with interactive TUI *and* a browser dashboard with real-time streaming, diff viewer, and approval gates. |
| 🔌 **Multi-Provider AI** | Pluggable LLM support: OpenRouter (default), OpenAI, Anthropic, Ollama — switch via config. |

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    USER INTERFACES                       │
│  ┌──────────────┐          ┌──────────────────────────┐  │
│  │  CLI (Ink)   │          │  Web UI (React + Vite)   │  │
│  └──────┬───────┘          └────────────┬─────────────┘  │
│         └──────────┬───────────────────-┘                │
│                    ▼                                     │
│        ┌─────────────────────┐                           │
│        │  Elysia HTTP/WS     │                           │
│        └──────────┬──────────┘                           │
└───────────────────│──────────────────────────────────────┘
                    ▼
┌──────────────────────────────────────────────────────────┐
│                 CORE LIBRARY                              │
│  Git Ops │ GitHub API │ Deps Merge │ License Scan        │
│  AI Agent│ Sandbox    │ Provenance │ Orchestration       │
│                                                          │
│  SQLite Job Queue  ·  Event Bus  ·  Result<T,E>          │
└──────────────────────────────────────────────────────────┘
                    │
     ┌──────────────┼──────────────┐
     ▼              ▼              ▼
  GitHub API    Docker Engine   LLM Providers
  (Octokit)     (dockerode)    (OpenRouter, Anthropic, Ollama)
```

### Monorepo Structure

```
RepoSplice/
├── packages/
│   ├── core/          # All business logic — zero UI deps
│   ├── cli/           # Terminal interface + Elysia server
│   └── web/           # React dashboard (Vite + Tailwind)
├── docker/            # Sandbox Dockerfiles
├── docs/              # Generated documentation
└── project-plans/     # PRD, Architecture, Roadmap, ADRs
```

---

## 🚀 Quick Start

### Prerequisites

| Tool | Version | Check |
|------|---------|-------|
| **Git** | ≥ 2.40 | `git --version` |
| **Bun** | ≥ 1.1 | `bun --version` |
| **Docker** | ≥ 24.0 | `docker --version` |
| **git-filter-repo** | latest | `git filter-repo --version` |

### Installation

```bash
# Clone the repository
git clone https://github.com/inbesat/RepoSplice-.git
cd RepoSplice-

# Install dependencies
bun install

# Verify your environment
bun run stitch doctor
```

### Usage

#### CLI — Merge Two Repos

```bash
# Initialize a new stitch project
stitch init my-project

# Add source repos with path selection
stitch add A owner/repo-a@main --paths src/auth,src/utils
stitch add B owner/repo-b@main --paths src/dashboard

# Run the merge
stitch merge

# Check status
stitch status
```

#### Web UI — Visual Merge Wizard

```bash
# Start the web dashboard
stitch serve

# Opens at http://localhost:3434
```

The web UI provides:
- **Repo Picker** — select repos, branches, and paths visually
- **File Tree** — browse and cherry-pick files with dependency highlighting
- **AI Thinking Stream** — watch the AI agent loop in real-time
- **Diff Viewer** — review AI-proposed changes with Accept/Reject gates
- **License Panel** — see compatibility at a glance
- **Sandbox Results** — live build/test output

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Runtime** | Bun (TypeScript) |
| **CLI** | Commander.js + Ink (React TUI) |
| **HTTP/WS** | Elysia |
| **Frontend** | React 18 + Vite + Tailwind CSS |
| **State** | Zustand + TanStack Query |
| **Components** | Radix UI Primitives |
| **Database** | SQLite (bun:sqlite) |
| **Git** | simple-git + git-filter-repo |
| **GitHub** | Octokit |
| **AI** | OpenRouter / OpenAI / Anthropic / Ollama |
| **Containers** | dockerode |
| **Validation** | Zod |
| **Error Handling** | neverthrow (Result\<T, E\>) |
| **Logging** | Pino |

> See [TECH_STACK.md](project-plans/TECH_STACK.md) for the complete, frozen technology blueprint.

---

## 📋 CLI Commands

| Command | Description |
|---------|-------------|
| `stitch init` | Initialize a new stitch project |
| `stitch add` | Add a source repository with path selection |
| `stitch merge` | Run the full merge pipeline |
| `stitch serve` | Start the web UI server |
| `stitch doctor` | Check system dependencies and configuration |
| `stitch status` | Show job history and current state |
| `stitch license` | Run standalone license scan |
| `stitch deps` | Analyze dependency graph |

---

## 🗺️ Roadmap

RepoSplice is built across **4 waves** with **366 phases** grouped into **19 epics**:

| Wave | Focus | Status |
|------|-------|--------|
| **Wave 0** | Foundation, dependencies, contract freeze | 🔧 In Progress |
| **Wave 1** | Core logic + CLI + Web UI (parallel tracks) | 📋 Planned |
| **Wave 1.5** | Eval framework, cross-lang support, confidence scoring, MCP | 📋 Planned |
| **Wave 2** | Integration, quality, documentation | 📋 Planned |
| **Wave 3** | Plugins, multi-user, enterprise features | 📋 Future |

> See [MASTER_PLAN.md](project-plans/MASTER_PLAN.md) for the full phased roadmap.

---

## 🔒 Security

- **No secrets in code** — `.env` files and environment variables only
- **Sandbox isolation** — Docker containers run with no network, read-only rootfs, memory/CPU limits
- **GitHub App auth** — fine-grained permissions preferred over PATs
- **AI provider keys** — never logged, redacted in audit output
- **Path traversal protection** — all file operations resolved against worktree root

> See [SECURITY.md](project-plans/SECURITY.md) for the full security policy.

---

## 📖 Documentation

| Document | Description |
|----------|-------------|
| [PRD.md](project-plans/PRD.md) | Product Requirements — scope, personas, features |
| [ARCHITECTURE.md](project-plans/ARCHITECTURE.md) | System architecture, data flow, DB schema |
| [TECH_STACK.md](project-plans/TECH_STACK.md) | Canonical technology choices (frozen) |
| [MASTER_PLAN.md](project-plans/MASTER_PLAN.md) | 366-phase roadmap across 4 waves |
| [DECISIONS.md](project-plans/DECISIONS.md) | Architecture Decision Records (ADRs) |
| [SECURITY.md](project-plans/SECURITY.md) | Security boundaries and policies |
| [INTEGRATIONS.md](project-plans/INTEGRATIONS.md) | Third-party API interface docs |
| [CONTEXT.md](project-plans/CONTEXT.md) | Documentation navigation index |

---

## 🤝 Contributing

We welcome contributions! Here's how to get started:

1. **Fork** the repository
2. **Clone** your fork and run `bun install`
3. **Read** the [CONTEXT.md](project-plans/CONTEXT.md) navigation index
4. **Check** [MASTER_PLAN.md](project-plans/MASTER_PLAN.md) for available phases
5. **Follow** the tech stack — see [TECH_STACK.md](project-plans/TECH_STACK.md)
6. **Submit** a PR with conventional commit messages (`feat:`, `fix:`, `chore:`)

### Quality Gates

All PRs must pass:

```bash
bun run lint        # Zero ESLint errors
bun run typecheck   # Zero TypeScript errors
bun run test        # All tests pass, coverage thresholds met
bun run build       # All packages build successfully
```

---

## 📊 Success Metrics (MVP Targets)

| Metric | Target |
|--------|--------|
| Time to green (from init to passing sandbox) | < 5 minutes |
| Merge success rate (first try) | > 80% |
| License false-negative rate | 0% |
| Provenance completeness | 100% |
| CLI cold-start time | < 2 seconds |
| Web UI time to interactive | < 3 seconds |

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

---

<div align="center">

**Built with 🧬 by [inbesat](https://github.com/inbesat)**

*Splice your repos. Ship faster.*

</div>
