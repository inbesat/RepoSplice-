$content = Get-Content 'E:\git project\project-plans\PHASES_DETAILED.md' -Raw
$newContent = $content -replace '### P-104: Deps .*? Parse package\.json\r\n\r\n---', @"
### P-104: Deps — Parse package.json

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-103

**Context:** Parse npm package.json manifests (dependencies, devDependencies, peerDependencies, scripts, engines).

**Files to Create/Modify:**
- `packages/core/src/deps/parse/npm.ts`

**Implementation Steps:**
```ts
export interface NpmManifest {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  scripts?: Record<string, string>
  engines?: Record<string, string>
}

export function parsePackageJson(content: string): Result<NpmManifest, StitchError>
export function serializePackageJson(manifest: NpmManifest): string
```

**Required MCPs/Connectors:** None (local parsing)

**Skills to Invoke:** None

**Acceptance Criteria:**
- [ ] Parses all dependency types (deps, devDeps, peerDeps, optionalDeps)
- [ ] Parses scripts and engines
- [ ] Serializes back to valid JSON
- [ ] Handles missing fields gracefully

**Tests Required:** Unit test with various package.json fixtures

**Dependencies:** P-103

**Handoff Notes:** Next: P-105 Parse requirements.txt/pyproject.toml.

---
"@
$newContent | Set-Content 'E:\git project\project-plans\PHASES_DETAILED.md' -Encoding UTF8