"""P-353 - the mandated `stitch merge` confidence-summary test.

Drives the real `mergeSummary` through the bun harness and asserts the summary
line it appends to the merge output, in both the `--no-color` and the themed
forms, plus the honest `N/A` line when the pipeline recorded no assessment.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
HARNESS = REPO_ROOT / "packages/cli/src/__tests__/fixtures/confidence-summary-harness.ts"

EXPECTED_LINE = (
    "Confidence: 87% (sandbox:✓ self:92 resolver:78 license:95 tests:88)"
    " [flags: low_resolver]"
)
NO_ASSESSMENT_LINE = "Confidence: N/A (no assessment recorded)"

_REPORT: dict | None = None


def run_harness() -> dict:
    """Run the bun harness once and return its report."""
    global _REPORT
    if _REPORT is not None:
        return _REPORT
    proc = subprocess.run(
        ["bun", str(HARNESS)],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    for line in proc.stdout.splitlines():
        if line.startswith("CONFIDENCE "):
            _REPORT = json.loads(line[len("CONFIDENCE ") :])
            return _REPORT
    raise AssertionError(
        f"the harness printed no CONFIDENCE line (exit {proc.returncode})\n"
        f"{proc.stdout}\n{proc.stderr}"
    )


def test_summary_output() -> None:
    """`mergeSummary` appends the confidence line to the merge output."""
    merge = run_harness()["merge"]
    # The default (themed) output still carries the whole summary; the paint
    # wraps the percentage in colour codes, so the check is paint-tolerant.
    themed = merge["lines"]
    assert themed[0] == "Dry run — no child repo written.", themed
    assert "Would write to: /tmp/stitch-child" in themed, themed
    assert any(
        "87%" in line
        and "(sandbox:✓ self:92 resolver:78 license:95 tests:88)" in line
        and "[flags: low_resolver]" in line
        for line in themed
    ), themed
    # The `--no-color` path renders the exact documented line, as the last line.
    assert merge["plain"][-1] == EXPECTED_LINE, merge["plain"]
    # A merge with no recorded assessment is honest about it.
    assert merge["withoutConfidence"][-1] == NO_ASSESSMENT_LINE, merge["withoutConfidence"]
    # `--verbose` adds the breakdown after the summary line.
    verbose = merge["verbose"]
    assert verbose[-8].startswith("Confidence: 87%"), verbose
    assert "  rationale: the change is well covered" in verbose, verbose
    assert "  sandbox: ✓" in verbose, verbose


def main() -> int:
    """Run every test in this file and report the result."""
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
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
