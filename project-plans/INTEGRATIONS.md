# INTEGRATIONS.md — Third-Party Integration Specifications
## repo-stitcher: Exact Interfaces, Request/Response Bodies, and Endpoints

**Version:** 1.0.0
**Status:** Frozen for MVP — changes require ADR
**Last Updated:** 2026-08-30

---

## 1. GitHub API (via @octokit/rest)

### 1.1 Authentication
```ts
// PAT (Personal Access Token)
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN })

// GitHub App (preferred for production)
import { createAppAuth } from '@octokit/auth-app'
const auth = createAppAuth({ appId, privateKey, installationId })
const { token } = await auth({ type: 'installation' })
const octokit = new Octokit({ auth: token })
```

**Required Scopes (PAT):** `repo`, `workflow`, `read:org`, `read:user`
**Required Permissions (App):** Contents (R/W), Metadata (R), Actions (R/W), Administration (R - for repo creation)

### 1.2 Key Endpoints Used

| Operation | Octokit Method | Parameters | Response Shape |
|-----------|----------------|------------|----------------|
| List user repos | `octokit.rest.repos.listForAuthenticatedUser` | `{ per_page: 100, sort: 'updated' }` | `Repo[]` |
| Search repos | `octokit.rest.search.repos` | `{ q: 'user:owner name:repo', per_page: 30 }` | `{ items: Repo[] }` |
| Get repo | `octokit.rest.repos.get` | `{ owner, repo }` | `Repo` |
| Get tree (recursive) | `octokit.rest.git.getTree` | `{ owner, repo, tree_sha: branch, recursive: '1' }` | `{ tree: TreeItem[] }` |
| Get file content | `octokit.rest.repos.getContent` | `{ owner, repo, path, ref }` | `{ content: base64, encoding: 'base64' }` |
| Create repo | `octokit.rest.repos.createForAuthenticatedUser` | `{ name, private: true, auto_init: false }` | `Repo` |
| Create ref (branch) | `octokit.rest.git.createRef` | `{ owner, repo, ref: 'refs/heads/branch', sha }` | `Ref` |
| Create PR | `octokit.rest.pulls.create` | `{ owner, repo, title, head, base, body }` | `PullRequest` |
| Trigger workflow | `octokit.rest.actions.createWorkflowDispatch` | `{ owner, repo, workflow_id, ref, inputs }` | `204` |
| Get workflow run | `octokit.rest.actions.getWorkflowRun` | `{ owner, repo, run_id }` | `WorkflowRun` |
| Get rate limit | `octokit.rest.rateLimit.get` | `{}` | `{ rate: { limit, remaining, reset } }` |

### 1.3 Rate Limit Handling
```ts
async function withBackoff<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn() }
  catch (e) {
    if (e.status === 403 && e.headers['retry-after']) {
      await sleep(parseInt(e.headers['retry-after']) * 1000)
      return withBackoff(fn)
    }
    if (e.status === 404) throw new NotFoundError()
    throw e
  }
}
```

### 1.4 GraphQL for Large Trees (Alternative to REST Tree)
```graphql
query RepoTree($owner: String!, $name: String!, $branch: String!) {
  repository(owner: $owner, name: $name) {
    object(expression: $branch) {
      ... on Tree {
        entries {
          name
          oid
          type
          path
        }
      }
    }
  }
}
```

---

## 2. Docker Engine (via dockerode)

### 2.1 Client Setup
```ts
import Docker from 'dockerode'
const docker = new Docker({ socketPath: '/var/run/docker.sock' }) // or TCP for remote
```

### 2.2 Sandbox Container Spec
```ts
interface SandboxOptions {
  image: string                    // e.g., 'ghcr.io/owner/repo-stitcher-sandbox:node-22'
  workdir: string                  // Host path to child repo (mounted RO)
  ecosystem: 'npm' | 'python' | 'go' | 'rust'
  commands: {
    install: string                // 'bun install' / 'pip install -r requirements.txt'
    build: string                  // 'bun run build' / 'cargo build --release'
    test: string                   // 'bun test' / 'pytest' / 'go test ./...'
  }
  limits: {
    memory: number                 // bytes (default: 4GB)
    cpu: number                    // CPUs (default: 2)
    pids: number                   // default: 100
    timeout: number                // ms (default: 600000 = 10min)
  }
}
```

### 2.3 Container Create Options
```ts
await docker.createContainer({
  Image: opts.image,
  Cmd: ['sh', '-c', 'sleep infinity'], // Keep alive; we exec commands
  HostConfig: {
    Memory: opts.limits.memory,
    NanoCpus: opts.limits.cpu * 1e9,
    PidsLimit: opts.limits.pids,
    NetworkMode: 'none',                    // NO NETWORK
    ReadonlyRootfs: true,
    CapDrop: ['ALL'],
    SecurityOpt: ['no-new-privileges'],
    Mounts: [
      { Type: 'bind', Source: opts.workdir, Target: '/workspace', ReadOnly: true },
      { Type: 'tmpfs', Target: '/tmp', TmpfsOptions: { SizeBytes: 512 * 1024 * 1024 } }
    ],
    Ulimits: [{ Name: 'nofile', Soft: 1024, Hard: 1024 }]
  },
  WorkingDir: '/workspace',
  User: '1000:1000' // Non-root
})
```

### 2.4 Exec Commands (Stream Output)
```ts
const container = await docker.getContainer(id)
await container.start()

for (const cmd of [install, build, test]) {
  const exec = await container.exec({
    Cmd: ['sh', '-c', cmd],
    AttachStdout: true,
    AttachStderr: true
  })
  const stream = await exec.start({ hijack: true, stdin: false })
  // Pump stream to logs; check exit code
  const { ExitCode } = await exec.inspect()
  if (ExitCode !== 0) throw new SandboxError(cmd, ExitCode, logs)
}
await container.stop({ t: 5 })
await container.remove({ force: true })
```

---

## 3. LLM Providers

### 3.1 OpenRouter (Default) — OpenAI-Compatible
**Base URL:** `https://openrouter.ai/api/v1`
**SDK:** `openai` npm package
```ts
import OpenAI from 'openai'
const client = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
  defaultHeaders: { 'HTTP-Referer': 'repo-stitcher', 'X-Title': 'repo-stitcher' }
})
```

**Tool Calling Request:**
```ts
const response = await client.chat.completions.create({
  model: 'anthropic/claude-3.5-sonnet',
  messages: [...],
  tools: toolSchemas,           // OpenAI-compatible JSON Schema
  tool_choice: 'auto',
  max_tokens: 4096,
  temperature: 0.1
})
```

**Response with Tool Calls:**
```ts
{
  choices: [{
    message: {
      role: 'assistant',
      content: null,
      tool_calls: [{
        id: 'call_abc',
        type: 'function',
        function: { name: 'fix_dependency', arguments: '{"file":"package.json","changes":[...]}' }
      }]
    }
  }]
}
```

**Models Known to Work (Tool Calling):**
- `anthropic/claude-3.5-sonnet` (default agent)
- `anthropic/claude-3.5-haiku`
- `openai/gpt-4o`
- `openai/gpt-4o-mini`
- `meta-llama/llama-3.1-70b-instruct`
- `meta-llama/llama-3.1-405b-instruct`

**⚠️ BROKEN via OpenRouter (DO NOT USE for agent loop):**
- `google/gemini-3-flash-preview`
- `google/gemini-3.1-pro-preview`
  *Reason: OpenRouter strips `thought_signature` → `MALFORMED_FUNCTION_CALL` on multi-turn.*

### 3.2 Anthropic (Native) — For Direct Access
**Base URL:** `https://api.anthropic.com`
**SDK:** `@anthropic-ai/sdk`
```ts
import Anthropic from '@anthropic-ai/sdk'
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
```

**Tool Calling (Anthropic Format):**
```ts
const response = await client.messages.create({
  model: 'claude-3-5-sonnet-20241022',
  max_tokens: 4096,
  tools: anthropicToolSchemas,  // Different schema format
  messages: [...]
})
```

**Adapter Required:** `AnthropicProvider` normalizes to internal `ChatProvider` interface.

### 3.3 Ollama (Local) — OpenAI-Compatible
**Base URL:** `http://localhost:11434/v1` (default)
**SDK:** `openai` npm package
```ts
const client = new OpenAI({
  baseURL: 'http://localhost:11434/v1',
  apiKey: 'ollama' // Dummy; Ollama ignores
})
```

**Models with Tool Calling (Ollama ≥0.1.34):**
- `llama3.1` / `llama3.1:70b`
- `nemotron3` / `nemotron3:70b`
- `command-r` / `command-r-plus`
- `qwen2.5` / `qwen2.5:72b`

**Check Support:** `ollama show <model> | grep -i tool`

---

## 4. Git Binary & git-filter-repo

### 4.1 Git (System)
```bash
git --version                    # ≥2.40 required
git clone --depth=1 <url>        # Shallow clone
git merge --allow-unrelated-histories -s ort
git subtree add --prefix=foo <repo> <branch>
git filter-repo --help           # Must be installed separately
```

### 4.2 git-filter-repo (Python Package)
```bash
pipx install git-filter-repo     # Recommended (isolated)
# OR
pip install git-filter-repo
```

**Key Invocation (Extract Paths to Subdirectory):**
```bash
git filter-repo \
  --path src/auth \
  --path src/utils \
  --to-subdirectory-filter repo-a \
  --tag-rename '':'repo-a-' \
  --force
```

**Output:** Repo rewritten in-place; only selected paths remain, moved under `repo-a/`, tags prefixed.

---

## 5. License Scanning

### 5.1 license-checker (npm) — Declared Licenses
```bash
npx license-checker --production --json --out licenses.json
```

**Output (licenses.json):**
```json
{
  "foo@1.0.0": {
    "licenses": "MIT",
    "repository": "https://github.com/...",
    "licenseFile": "/path/to/node_modules/foo/LICENSE",
    "path": "/path/to/node_modules/foo"
  }
}
```

**Programmatic (core):**
```ts
import licenseChecker from 'license-checker'
licenseChecker.init({ start: repoPath, production: true, json: true }, (err, pkgs) => { ... })
```

### 5.2 SPDX Utilities
```ts
import { parseExpression, correct } from 'spdx-expression-parse'
import { licenses } from 'spdx-license-list'

const normalized = correct('MIT')  // 'MIT'
const parsed = parseExpression('MIT OR Apache-2.0')
```

### 5.3 ScanCode Toolkit (Optional Deep Scan)
```bash
pipx install scancode-toolkit
scancode -clpieu --json-pp output.json /path/to/repo
```

**Output:** Per-file license/copyright detection with confidence scores.

---

## 6. CLI Server API (Elysia) — Internal Contract

### 6.1 REST Endpoints
| Method | Path | Request Body | Response |
|--------|------|--------------|----------|
| GET | `/api/health` | — | `{ ok: true, version: string }` |
| GET | `/api/schema` | — | OpenAPI 3.1 JSON (core types) |
| POST | `/api/jobs` | `StitchInput` | `{ jobId: string }` |
| GET | `/api/jobs/:id` | — | `JobStatus` |
| POST | `/api/jobs/:id/cancel` | — | `{ ok: true }` |
| POST | `/api/jobs/:id/approve` | `{ toolCallId: string }` | `{ ok: true }` |
| POST | `/api/jobs/:id/reject` | `{ toolCallId: string, reason?: string }` | `{ ok: true }` |

### 6.2 WebSocket `/ws?jobId=<id>`
**Server → Client Messages:**
```ts
type ServerMsg =
  | { type: 'event'; event: JobEvent }
  | { type: 'proposal'; proposal: ToolProposal }
  | { type: 'reasoning'; chunk: ReasoningChunk }
  | { type: 'error'; message: string }
  | { type: 'done'; output: StitchOutput }

interface JobEvent {
  jobId: string
  step: 'clone' | 'extract' | 'merge' | 'ai-loop' | 'verify' | 'publish'
  status: 'started' | 'completed' | 'failed'
  message: string
  timestamp: number
}

interface ToolProposal {
  toolCallId: string
  toolName: 'propose_component'
  diff: string              // Unified diff of proposed files
  description: string       // AI's explanation
  files: { path: string; content: string }[]
}

interface ReasoningChunk {
  text: string
  isComplete: boolean
}
```

**Client → Server Messages:**
```ts
type ClientMsg =
  | { type: 'subscribe'; jobId: string }
  | { type: 'approve'; jobId: string; toolCallId: string }
  | { type: 'reject'; jobId: string; toolCallId: string; reason?: string }
  | { type: 'cancel'; jobId: string }
```

---

## 7. Configuration File Formats

### 7.1 `~/.stitch/config.json` (CLI Global)
```json
{
  "version": 1,
  "github": {
    "authType": "pat",           // "pat" | "app"
    "token": "ghp_...",          // if pat
    "appId": "12345",            // if app
    "privateKeyPath": "/path",   // if app
    "installationId": "67890"    // if app
  },
  "openrouter": {
    "apiKey": "sk-or-...",
    "defaultModel": "anthropic/claude-3.5-sonnet"
  },
  "anthropic": {
    "apiKey": "sk-ant-..."
  },
  "ollama": {
    "baseUrl": "http://localhost:11434/v1"
  },
  "sandbox": {
    "backend": "docker",         // "docker" | "github-actions"
    "dockerHost": "unix:///var/run/docker.sock",
    "limits": { "memory": 4294967296, "cpu": 2, "timeout": 600000 }
  },
  "paths": {
    "cacheDir": "~/.stitch/cache",
    "worktreeDir": "~/.stitch/worktrees"
  },
  "licensePolicy": {
    "allow": ["MIT", "Apache-2.0", "BSD-3-Clause", "ISC"],
    "warn": ["LGPL-2.1", "MPL-2.0"],
    "deny": ["GPL-2.0", "GPL-3.0", "AGPL-3.0", "SSPL-1.0"]
  },
  "autonomy": {
    "auto": ["fix_dependency", "edit_config", "move_file", "run_build"],
    "gated": ["propose_component"]
  }
}
```

### 7.2 `.stitch/config.json` (Project-Local, Overrides Global)
```json
{
  "extends": "global",
  "sandbox": { "backend": "github-actions" }
}
```

---

## 8. Sandbox Base Images (Docker)

| Ecosystem | Image Tag | Contents |
|-----------|-----------|----------|
| **Node/Bun** | `ghcr.io/owner/repo-stitcher-sandbox:node-22` | Bun 1.1, Node 22, pnpm, yarn, git, git-filter-repo |
| **Python** | `ghcr.io/owner/repo-stitcher-sandbox:python-3.12` | Python 3.12, pip, uv, poetry, git, git-filter-repo |
| **Go** | `ghcr.io/owner/repo-stitcher-sandbox:go-1.22` | Go 1.22, git, git-filter-repo |
| **Rust** | `ghcr.io/owner/repo-stitcher-sandbox:rust-1.80` | Rust 1.80, cargo, git, git-filter-repo |
| **Multi** | `ghcr.io/owner/repo-stitcher-sandbox:multi` | All above (larger) |

**Build Trigger:** GitHub Actions on tag push to `repo-stitcher` repo.

---

## 9. Error Codes & Standardized Responses

### 9.1 Core Error Types (returned as `Result<_, StitchError>`)
```ts
type StitchError =
  | { code: 'GIT_ERROR'; message: string; gitOutput?: string }
  | { code: 'GITHUB_API_ERROR'; status: number; message: string }
  | { code: 'DOCKER_ERROR'; message: string; containerId?: string }
  | { code: 'AI_PROVIDER_ERROR'; provider: string; message: string }
  | { code: 'LICENSE_VIOLATION'; license: string; policy: 'warn' | 'deny' }
  | { code: 'DEPENDENCY_CONFLICT'; packages: string[]; details: string }
  | { code: 'SANDBOX_FAILED'; step: 'install' | 'build' | 'test'; logs: string }
  | { code: 'CONFIG_ERROR'; field: string; message: string }
  | { code: 'USER_CANCELLED'; reason: string }
  | { code: 'INTERNAL'; message: string; cause?: Error }
```

### 9.2 HTTP Error Responses (Server)
```ts
// 400
{ error: 'VALIDATION_ERROR', details: ZodError[] }
// 401
{ error: 'UNAUTHORIZED', message: 'GitHub token invalid' }
// 404
{ error: 'NOT_FOUND', resource: 'job', id: '...' }
// 409
{ error: 'CONFLICT', message: 'Job already running' }
// 500
{ error: 'INTERNAL', message: '...' }
```

---

*End of INTEGRATIONS.md. This file is the authoritative reference for all external interfaces. Update when APIs change.*