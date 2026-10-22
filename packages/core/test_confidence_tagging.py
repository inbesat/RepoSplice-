"""P-342 — the resolution confidence tagging tests (the mandated ids).

The CI is bun-only, so the python ids drive the real registry through the bun
harness (packages/core/src/__tests__/fixtures/confidence-tagging-harness.ts).
The harness shows all three tags: `lsp-high` from a language server, 
`heuristic-medium` from the deterministic fallback, and the single
`unresolved` marker edge when nothing could answer.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
HARNESS = (
    REPO_ROOT
    / "packages"
    / "core"
    / "src"
    / "__tests__"
    / "fixtures"
    / "confidence-tagging-harness.ts"
)

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
    raise AssertionError(f"the harness printed no RESOLVE line: {proc.stdout}\n{proc.stderr}")


def test_lsp_tag() -> None:
    """A language-server answer is tagged lsp-high."""
    report = run_harness()
    entry = report["lsp"]
    assert entry["ok"] is True, entry
    assert entry["confidence"] == "lsp-high", entry
    assert entry["target"] == "src/helper.ts", entry
    assert report["lspDistribution"]["lsp-high"] == 1, report["lspDistribution"]


def test_heuristic_tag() -> None:
    """The deterministic fallback is tagged heuristic-medium."""
    report = run_harness()
    entry = report["heuristic"]
    assert entry["ok"] is True, entry
    assert entry["confidence"] == "heuristic-medium", entry
    assert entry["target"] == "src/helper.ts", entry
    assert report["heuristicDistribution"]["heuristic-medium"] == 1, report["heuristicDistribution"]


def test_unresolved_tag() -> None:
    """An import nothing could resolve is one unresolved edge, not an error."""
    report = run_harness()
    entry = report["unresolved"]
    assert entry["ok"] is True, entry
    assert entry["confidence"] == "unresolved", entry
    assert entry["target"] == "", entry
    assert entry["count"] == 1, entry
    distribution = report["distribution"]
    assert distribution["unresolved"] == 1, distribution
    assert distribution["total"] >= 1, distribution


def main() -> int:
    """Run every test in this file and report the result."""
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
