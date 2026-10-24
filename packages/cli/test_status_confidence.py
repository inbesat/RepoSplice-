"""P-353 - the mandated `stitch status` confidence-summary test.

Drives the real `renderStatusReport` through the bun harness and asserts the
confidence line it renders for a job: the summary when an assessment is
recorded, and the honest `N/A` line when none is.
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


def test_status_output() -> None:
    """`renderStatusReport` renders the confidence line for the job."""
    status = run_harness()["status"]
    with_confidence = status["withConfidence"]
    without_confidence = status["withoutConfidence"]
    # The report still renders its usual sections.
    assert with_confidence[0] == "stitch status", with_confidence
    assert without_confidence[0] == "stitch status", without_confidence
    # The confidence line is always present, right after the jobs lines.
    assert EXPECTED_LINE in with_confidence, with_confidence
    assert NO_ASSESSMENT_LINE in without_confidence, without_confidence
    assert "Confidence: 87%" not in without_confidence, without_confidence
    # It sits between the jobs line and the sandbox line, so it is visible in
    # the default (non-verbose) output without scrolling to the end.
    jobs_at = with_confidence.index("jobs: no pipeline state yet")
    confidence_at = with_confidence.index(EXPECTED_LINE)
    sandbox_at = with_confidence.index("sandbox: docker available")
    assert jobs_at < confidence_at < sandbox_at, with_confidence


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
