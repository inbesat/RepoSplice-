"""P-356 — the confidence scoring and threshold edge cases.

The CI is bun-only, so these tests drive the real modules through the bun
harness (packages/core/src/__tests__/fixtures/confidence-docs-harness.ts) and
assert on its report. The document itself is checked by docs/test_confidence_md.py.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
HARNESS = REPO_ROOT / "packages/core/src/__tests__/fixtures/confidence-docs-harness.ts"

FINAL_WEIGHTS = {
    "sandbox_pass": 0.3,
    "self_confidence": 0.25,
    "resolver_confidence": 0.2,
    "license_risk": 0.15,
    "test_coverage": 0.1,
}

_REPORT: dict | None = None


def run_harness() -> dict:
    """Drive the harness once and return its report."""
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
    line = next(
        (row for row in proc.stdout.splitlines() if row.startswith("CONFIDENCE_DOCS ")),
        None,
    )
    if line is None:
        raise AssertionError(
            f"the harness printed no report (exit {proc.returncode}): "
            f"{proc.stdout}\n{proc.stderr}"
        )
    _REPORT = json.loads(line[len("CONFIDENCE_DOCS ") :])
    return _REPORT


def test_scoring_edge_cases() -> None:
    """The documented edge cases score what the formula says they score."""
    report = run_harness()
    cases = report["edgeCases"]
    # license_risk is RISK: no risk is the safest input, maximal risk costs points.
    assert cases["allZeros"]["composite"] == 15, cases["allZeros"]
    assert cases["allHundreds"]["composite"] == 85, cases["allHundreds"]
    assert cases["worst"]["composite"] == 0, cases["worst"]
    assert cases["best"]["composite"] == 100, cases["best"]
    assert cases["strong"]["composite"] == 77, cases["strong"]
    # a missing factor is refused, never scored
    missing = cases["missingComponent"]
    assert missing["composite"] is None, missing
    assert missing["error"] == "CONFIG_ERROR", missing
    assert missing["field"] == "confidence.components", missing
    # every emitted score stays inside the documented bounds
    for name in ("allZeros", "allHundreds", "worst", "best", "strong"):
        value = cases[name]["composite"]
        assert isinstance(value, int) and 0 <= value <= 100, (name, value)
    # the weights are the documented set and sum to one
    assert report["weights"] == FINAL_WEIGHTS, report["weights"]
    assert abs(report["weightsSum"] - 1.0) <= 1e-6, report["weightsSum"]
    # explain() names the composite and the rubric band
    assert report["explain"]["mentionsComposite"] is True, report["explain"]
    assert report["explain"]["hasRubricBand"] is True, report["explain"]
    assert report["explain"]["lines"] >= 7, report["explain"]
    # the same components fold into the same document score
    assert report["document"]["composite"] == 77, report["document"]


def test_threshold_boundary() -> None:
    """74 routes to review and 75 does not; the default is the documented 75."""
    report = run_harness()
    threshold = report["threshold"]
    assert threshold["default"] == 75, threshold
    at = threshold["at"]
    assert at["composite"] == 75, at
    assert at["autoApprove"] is True, at
    assert at["requiresHumanReview"] is False, at
    below = threshold["below"]
    assert below["composite"] == 74, below
    assert below["autoApprove"] is False, below
    assert below["requiresHumanReview"] is True, below
    assert "below the 75" in below["reason"], below
    assert at["threshold"] == 75 and below["threshold"] == 75, threshold
    assert threshold["margin"] == 1, threshold


def main() -> int:
    """Run every test in this file and report the result."""
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    failures = 0
    for name, test in sorted(globals().items()):
        if not name.startswith("test_") or not callable(test):
            continue
        try:
            test()
        except AssertionError as error:
            failures += 1
            print(f"FAIL {name}: {error}")
        else:
            print(f"ok {name}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
