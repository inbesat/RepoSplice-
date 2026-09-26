# Detect Gaps Prompt

Your task is to analyze a codebase tree and identify gaps against a target specification.

## Codebase Tree

{{treeSummary}}

## Instructions

1. Call `detect_gaps` with the tree summary and target criteria.
2. The tool will return missing files, incomplete implementations, test coverage gaps, and documentation gaps.
3. Summarize findings in a structured report.

## Output Format

Return a JSON object with:
```json
{
  "missingFiles": ["path/to/file.ts", ...],
  "incompleteImplementations": [{ "file": "...", "issue": "..." }],
  "testGaps": [{ "file": "...", "missing": "..." }],
  "docGaps": ["..."],
  "summary": "Brief overall assessment"
}
```