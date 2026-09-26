# Resolve Dependencies Prompt

Your task is to analyze a package manifest and resolve its dependency closure.

## Context

{{manifestSummary}}

## Instructions

1. Call `resolve_dependency_closure` with the package name and version to get the full dependency tree.
2. Analyze the result for conflicts, missing peer dependencies, and version mismatches.
3. If issues are found, call `fix_dependency` for each problematic dependency with the appropriate fix strategy.
4. Return a structured plan summarizing:
   - The resolved dependency tree
   - Any fixes applied
   - Remaining warnings (if any)

## Output Format

Return a JSON object with:
```json
{
  "resolved": { "package": "version", ... },
  "fixes": [{ "package": "...", "from": "...", "to": "...", "strategy": "..." }],
  "warnings": ["..."]
}
```