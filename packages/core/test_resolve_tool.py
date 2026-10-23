"""P-343 — the resolve_dependency_closure integration tests (the mandated ids).

The CI is bun-only, so the python ids drive the real tool through the bun
harness (packages/core/src/__tests__/fixtures/resolve-tool-harness.ts) and
assert on its report. The harness measures the import-resolution failures
BEFORE (the P-149 lexical walk) and AFTER (the same walk with the P-341
registry) over the four ground-truth fixtures, and it records the honest
corpus-level deferral: the Epic 16 re-run needs Docker and an AI provider key,
so the corpus number stays unmeasured rather than invented.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
HARNESS = REPO_ROOT / "packages/core/src/__tests__/fixtures/resolve-tool-harness.ts"
ARTIFACT = REPO_ROOT / "eval/resolve_tool/comparison.json"
CONFIDENCE_TAGS = {"lsp-high", "heuristic-medium", "unresolved"}

_REPORT: dict | None = None


def run_harness() -> dict:
    """Drive the harness and return its report."""
    global _REPORT
    if _REPORT is not None:
        return _REPORT
    proc = subprocess.run(
        ["bun", str(HARNESS)],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise AssertionError(
            f"the harness failed ({proc.returncode}): {proc.stdout}\n{proc.stderr}"
        )
    for line in proc.stdout.splitlines():
        if line.startswith("RESOLVE "):
            _REPORT = json.loads(line[len("RESOLVE ") :])
            return _REPORT
    raise AssertionError(
        f"the harness printed no RESOLVE line: {proc.stdout}\n{proc.stderr}"
    )


def test_uses_new_registry() -> None:
    """The tool resolves through the registry and tags every edge."""
    report = run_harness()
    registry = report["registry"]
    assert registry["ok"] is True, registry
    edges = registry["edges"]
    assert edges, registry
    for edge in edges:
        assert edge["confidence"] in CONFIDENCE_TAGS, edge
        assert edge["targetFile"], edge
    # An internal edge, resolved through the heuristic fallback.
    assert any(
        edge["targetFile"] == "src/helper.ts" and edge["confidence"] == "heuristic-medium"
        for edge in edges
    ), edges
    # A package specifier stays a requirement, never an internal edge.
    assert "fake-pkg" in registry["required"], registry
    assert not any(edge["targetFile"].startswith("node_modules/") for edge in edges), edges


def test_corpus_improvement() -> None:
    """The registry reduces the import-resolution failures measurably."""
    report = run_harness()
    before = report["before"]
    after = report["after"]
    assert after["total"] == before["total"], (before, after)
    assert after["resolved"] > before["resolved"], (before, after)
    assert report["comparison"]["improvement"] > 0, report["comparison"]
    assert report["comparison"]["afterFailures"] < report["comparison"]["beforeFailures"], report
    # The corpus-level number is NOT measured here: the Epic 16 re-run needs
    # Docker and an AI provider key, and a missing measurement is never a zero.
    corpus = report["corpus"]
    assert corpus["measured"] is False, corpus
    assert "Docker" in corpus["reason"], corpus
    # The evidence artifact is written for the ADR.
    artifact = json.loads(ARTIFACT.read_text(encoding="utf-8"))
    assert artifact["comparison"]["improvement"] == report["comparison"]["improvement"], artifact


def main() -> int:
    failures = 0
    for name, test in sorted(globals().items()):
        if not name.startswith("test_") or not callable(test):
            continue
        try:
            test()
            print(f"ok {name}")
        except AssertionError as error:
            failures += 1
            print(f"FAIL {name}: {error}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
