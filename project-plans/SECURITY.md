# SECURITY.md — Authorization & Security Boundaries
## repo-stitcher: Mandatory Security Rules for AI and Human Developers

**Version:** 1.0.0
**Status:** Enforced — violations block PR merge
**Last Updated:** 2026-08-30

---

## 1. Secrets Management (Zero Tolerance)

| Rule | Enforcement |
|------|-------------|
| **Never commit secrets** (API keys, tokens, passwords, private keys) | `git-secrets` / `trufflehog` in pre-commit + CI |
| **Never log secrets** | Pino `redact` paths: `*.apiKey`, `*.token`, `*.secret`, `*.password`, `*.privateKey` |
| **Never pass secrets via command line args** | Use env vars or config files only |
| **Never hardcode secrets in code** | ESLint rule `no-hardcoded-secrets` (custom) |
| **Use `configstore` (encrypted) for CLI credentials** | `~/.stitch/config.json` encrypted by `configstore` |
| **Use `.env` for server (never committed)** | `.env` in `.gitignore`; `.env.example` committed |

### 1.1 Secret Patterns to Redact (Logger Config)
```ts
// core/src/logger/redact.ts
export const redactPaths = [
  '**.apiKey',
  '**.token',
  '**.secret',
  '**.password',
  '**.privateKey',
  '**.accessToken',
  '**.refreshToken',
  '**.webhookSecret',
  '**.signingKey',
  'github.auth.token',
  'openrouter.apiKey',
  'anthropic.apiKey',
  'ollama.apiKey', // dummy but redact anyway
  'docker.authConfig',
  'sandbox.env.*'
]
```

### 1.2 Required Environment Variables (Runtime)
| Variable | Purpose | Required For |
|----------|---------|--------------|
| `GITHUB_TOKEN` | GitHub PAT | GitHub API (fallback) |
| `GITHUB_APP_ID` | GitHub App ID | GitHub App auth |
| `GITHUB_PRIVATE_KEY` | GitHub App private key (PEM) | GitHub App auth |
| `GITHUB_INSTALLATION_ID` | Installation ID | GitHub App auth |
| `OPENROUTER_API_KEY` | OpenRouter API key | AI provider (default) |
| `ANTHROPIC_API_KEY` | Anthropic API key | AI provider (alt) |
| `OLLAMA_BASE_URL` | Ollama endpoint | Local AI provider |

---

## 2. Authorization Boundaries

### 2.1 GitHub Permissions (Least Privilege)

| Auth Method | Required Scopes/Permissions | Use Case |
|-------------|----------------------------|----------|
| **PAT (Classic)** | `repo` (full), `workflow`, `read:org`, `read:user` | Personal use, CI |
| **PAT (Fine-grained)** | Repository access: selected repos; Permissions: Contents (R/W), Metadata (R), Actions (R/W), Administration (R - for repo creation) | Production preferred |
| **GitHub App** | Contents (R/W), Metadata (R), Actions (R/W), Administration (R) | Multi-user, org-wide |

**Never request:** `admin:org`, `delete_repo`, `workflow` beyond dispatch, `gist`, `user:email` beyond read.

### 2.2 Internal API Authorization (CLI Server)

```ts
// No auth for local dev (localhost only)
// For future multi-user: JWT signed by server, validated on WS connect
// Current MVP: Trust local machine; bind to 127.0.0.1
const server = new Elysia().listen(3434, '127.0.0.1')
```

### 2.3 AI Provider Access Control

| Provider | Key Storage | Rotation |
|----------|-------------|----------|
| OpenRouter | `configstore` (encrypted) | User-managed |
| Anthropic | `configstore` (encrypted) | User-managed |
| Ollama | None (local) | N/A |

**AI agents must never:**
- Log full prompts/responses containing secrets
- Store keys in SQLite (only usage metrics: tokens, cost)
- Make unauthenticated calls to provider APIs

---

## 3. Data Validation & Sanitization

### 3.1 Input Validation (All External Input)

| Source | Validation Method |
|--------|-------------------|
| GitHub API responses | Zod schemas matching Octokit types |
| User-provided paths (CLI/UI) | `path.resolve()` + `startsWith(worktreeRoot)` guard |
| AI tool call arguments | Zod schema per tool (generated from tool def) |
| Config files (JSON/YAML) | `ConfigSchema.parse()` (Zod) |
| Docker exec output | Size limit (10MB); timeout; no shell injection |
| File reads (repo content) | Size limit (50MB/file); encoding validation (UTF-8) |

### 3.2 Path Traversal Prevention
```ts
// core/src/util/paths.ts
export function safeResolve(base: string, target: string): string {
  const resolved = path.resolve(base, target)
  const normalizedBase = path.resolve(base)
  if (!resolved.startsWith(normalizedBase + path.sep) && resolved !== normalizedBase) {
    throw new Error(`Path traversal attempt: ${target}`)
  }
  return resolved
}
// Usage: ALWAYS use safeResolve(worktreeRoot, userPath)
```

### 3.3 SQL Injection Prevention
- **No raw SQL concatenation** — use parameterized queries only
- SQLite via `bun:sqlite` — `db.prepare('SELECT * FROM jobs WHERE id = ?').get(id)`
- No ORM = no query builder injection surface

### 3.4 XSS Prevention (Web UI)
- **No `dangerouslySetInnerHTML`** — ESLint rule forbids
- **React auto-escapes** — default behavior
- **Shiki/Code highlighting** — outputs safe HTML (sanitized by Shiki)
- **Diff viewer** — `react-diff-viewer-continued` sanitizes
- **User-generated content** (commit messages, PR titles) — escaped by React

### 3.5 Command Injection Prevention
```ts
// NEVER: exec(`git clone ${userUrl}`)
// ALWAYS:
await $`git clone ${userUrl}` // Bun's template literal (safe)
// OR simple-git:
await git.clone(userUrl, dir) // Library handles escaping
// For filter-repo:
await $`git filter-repo ${args.map(escapeArg)}` // Explicit arg array
```

---

## 4. Sandbox Security (Build/Test Isolation)

### 4.1 Container Hardening (Mandatory)
```ts
// core/src/sandbox/security.ts
export const HARDENED_HOST_CONFIG: Docker.HostConfig = {
  NetworkMode: 'none',                    // NO NETWORK ACCESS
  ReadonlyRootfs: true,                   // CANNOT WRITE TO ROOT FS
  CapDrop: ['ALL'],                       // DROP ALL CAPABILITIES
  SecurityOpt: ['no-new-privileges'],     // PREVENT PRIVILEGE ESCALATION
  PidsLimit: 100,                         // LIMIT PROCESSES
  Memory: 4 * 1024 * 1024 * 1024,         // 4GB RAM
  NanoCpus: 2 * 1e9,                      // 2 CPU
  Ulimits: [{ Name: 'nofile', Soft: 1024, Hard: 1024 }],
  Mounts: [
    { Type: 'bind', Source: workdir, Target: '/workspace', ReadOnly: true },
    { Type: 'tmpfs', Target: '/tmp', TmpfsOptions: { SizeBytes: 512 * 1024 * 1024 } }
  ],
  User: '1000:1000'                       // NON-ROOT USER
}
```

### 4.2 Secrets in Sandbox
- **No secrets mounted** — workdir is read-only source code only
- **No env vars passed** — container gets only `PATH`, `HOME`, `USER`
- **Build tools** (npm, cargo, go) run without registry auth (public deps only)
- **Private deps** — user must vendor or use public mirrors pre-merge

### 4.3 Resource Limits (DoS Prevention)
| Resource | Limit | Enforcement |
|----------|-------|-------------|
| Memory | 4GB | Docker `--memory` |
| CPU | 2 cores | Docker `--cpus` |
| Processes | 100 | Docker `--pids-limit` |
| Wall time | 10 min | `dockerode` timeout + `setTimeout` kill |
| Disk (tmpfs) | 512MB | Docker `--tmpfs /tmp:size=512m` |
| Output logs | 10MB | Stream truncation |

---

## 5. Git Operations Security

### 5.1 Clone Safety
- **Shallow clone by default** (`--depth=1`) — limits history download
- **Sparse checkout** for large repos — only fetch needed paths
- **No submodule auto-fetch** — `--recurse-submodules=false` unless explicit

### 5.2 Filter-Repo Safety
- **Run on fresh clone only** — `git filter-repo` refuses on repos with remotes unless `--force`
- **We never use `--force`** — always clone to temp dir first
- **Tag rename** — prevents tag collisions when merging

### 5.3 Push Safety
- **Push to new branch only** — never force-push to `main`/`master`
- **Repo C created fresh** — `octokit.repos.create` then push
- **No deletion of parent repos** — read-only access to A, B

---

## 6. AI Safety Boundaries

### 6.1 Tool Call Guardrails
```ts
// core/src/ai/tools/guardrails.ts
export const TOOL_GUARDRAILS = {
  // File operations
  write_file: { maxSize: 1_000_000, allowedPaths: ['/workspace/**'] },
  move_file: { allowedPaths: ['/workspace/**'] },
  // Shell commands
  run_shell: { ALLOWED_CMDS: ['bun', 'npm', 'pip', 'cargo', 'go', 'git'], timeout: 30000 },
  // Network
  fetch_url: { ALLOWED_HOSTS: ['api.github.com', 'registry.npmjs.org', 'pypi.org'] },
  // Prohibited
  delete_file: { REQUIRE_HUMAN_APPROVAL: true },
  modify_git_history: { FORBIDDEN: true }
}
```

### 6.2 Prompt Injection Mitigation
- **System prompt fixed** — not user-controllable
- **User input sanitized** — repo content treated as data, not instructions
- **Tool descriptions explicit** — AI cannot "discover" hidden tools
- **Max loop iterations** — hard cap (25) prevents runaway

### 6.3 Model-Specific Restrictions
- **Gemini 3 via OpenRouter: FORBIDDEN for agent loop** — known tool-calling bug
- **Local models (Ollama): Only if `supportsTools: true`** — verified at startup
- **Cost limits** — per-job token budget (default 500k tokens); auto-abort on exceed

---

## 7. Dependency Security

### 7.1 Supply Chain
- **Exact versions in `package.json`** — no `^`/`~`; updated via Dependabot PRs
- **`bun audit` in CI** — fails on high/critical
- **`license-checker --failOn GPL-3.0,AGPL-3.0`** — blocks copyleft in permissive project
- **No unpinned Git dependencies** — all deps from npm registry

### 7.2 Prohibited Dependencies (ESLint `no-restricted-imports`)
```json
{
  "rules": {
    "no-restricted-imports": [
      "error",
      {
        "patterns": [
          "axios", "node-fetch", "ky", "got",
          "prisma", "drizzle-orm", "typeorm", "sequelize", "knex",
          "jest", "@jest/*",
          "webpack", "rollup", "esbuild",
          "redux", "@reduxjs/*", "mobx", "recoil", "jotai",
          "moment", "date-fns",
          "joi", "yup", "class-validator",
          "socket.io", "ws",
          "better-sqlite3"
        ]
      }
    ]
  }
}
```

---

## 8. Compliance & Audit

### 8.1 License Compliance (Automated)
- **Every merge** → `license-checker` scan → fail on `deny` list
- **SBOM generated** (CycloneDX) for every child repo C
- **CREDITS.md** includes license per source file

### 8.2 Audit Logging
```ts
// Structured audit log (Pino)
logger.info({
  event: 'STITCH_JOB_COMPLETED',
  jobId,
  user: 'local', // or github handle
  parentRepos: ['ownerA/repoA', 'ownerB/repoB'],
  childRepo: 'ownerC/repoC',
  licenseReport: { allowed: 42, warnings: 2, denied: 0 },
  aiUsage: { provider: 'openrouter', model: 'claude-3.5-sonnet', tokens: 12345, cost: 0.045 },
  sandboxResult: 'passed',
  durationMs: 245000
})
```

### 8.3 Data Retention
| Data | Retention | Location |
|------|-----------|----------|
| Job history | 90 days | SQLite (`jobs`, `job_events`) |
| Provider usage | 365 days | SQLite (`provider_usage`) |
| Repo cache | 1 hour TTL | SQLite (`repo_cache`) |
| Audit logs | 365 days | File/stdout (rotate daily) |
| Sandbox containers | Ephemeral | Auto-removed on completion |

---

## 9. Incident Response

### 9.1 Secret Leak (If Detected)
1. **Immediately rotate** the leaked key (GitHub, OpenRouter, Anthropic)
2. **Run `bun run security:scan`** — `trufflehog git file://. --since-commit HEAD~10`
3. **Force-push** cleaned history (if in unreleased branch)
4. **Document in DECISIONS.md** — ADR for rotation

### 9.2 Supply Chain Compromise
1. **Pin all deps to known-good versions** — `bun install --frozen-lockfile`
2. **Run `bun audit --level=high`**
3. **Review Dependabot PRs** before merge

### 9.3 Sandbox Escape (Theoretical)
1. **Container runs as non-root, no caps, no network** — escape unlikely
2. **If suspected:** Stop Docker daemon; inspect container FS; rotate host keys
3. **Report** to Docker/security team

---

## 10. Security Checklist for Every PR

```
☐ No secrets in code, logs, or config
☐ All external input validated via Zod
☐ Path traversal prevented (safeResolve used)
☐ SQL uses parameterized queries only
☐ No XSS vectors (no dangerouslySetInnerHTML)
☐ No command injection (Bun $ template or lib)
☐ Sandbox uses hardened container config
☐ AI tools have guardrails + loop cap
☐ Dependencies exact versions + audit clean
☐ License scan passes (no GPL/AGPL in deny list)
☐ SBOM + CREDITS.md generated for merge
☐ SECURITY.md rules followed
```

---

*End of SECURITY.md. This file is the security constitution. Any violation = immediate block. Update only via ADR in DECISIONS.md.*