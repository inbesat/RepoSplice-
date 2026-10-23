"""P-350 — the confidence threshold policy's mandated tests.

The CI is bun-only, so the python ids drive the real module through the bun
harness (packages/core/src/__tests__/fixtures/threshold-harness.ts) and assert
on its report.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
HARNESS = REPO_ROOT / "packages" / "core" / "src" / "__tests__" / "fixtures" / "threshold-harness.ts"

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
    )
    for line in proc.stdout.splitlines():
        if line.startswith("THRESHOLD "):
            _REPORT = json.loads(line[len("THRESHOLD ") :])
            return _REPORT
    raise AssertionError(
        f"the harness printed no THRESHOLD line (exit {proc.returncode})\n"
        f"{proc.stdout}\n{proc.stderr}"
    )


def test_default_threshold() -> None:
    """The default is 75, the range is 0-100, and a bad value is refused."""
    report = run_harness()
    assert report["default"] == 75, report
    assert report["range"] == {"min": 0, "max": 100}, report
    assert report["configDefault"] == 75, report
    assert report["configRoundTrip"] == 75, report
    refusals = report["refusals"]
    assert len(refusals) == 3, refusals
    for refusal in refusals:
        assert refusal["code"] == "CONFIG_ERROR", refusal
        assert refusal["field"] == "confidence.auto_approve_threshold", refusal


def test_override_flag() -> None:
    """The per-run flag beats the config file, which beats the default."""
    report = run_harness()
    precedence = report["precedence"]
    assert precedence["flag"] == 90, precedence
    assert precedence["config"] == 40, precedence
    assert precedence["fallback"] == 75, precedence
    assert precedence["flagBeatsConfig"] is True, precedence
    assert precedence["badFlagCode"] == "CONFIG_ERROR", precedence


def test_hil_routing() -> None:
    """A low composite carries the requires-human-review decision."""
    report = run_harness()
    below = report["below"]
    assert below["autoApprove"] is False, below
    assert below["requiresHumanReview"] is True, below
    assert "below the 75" in below["reason"], below
    at_threshold = report["atThreshold"]
    assert at_threshold["autoApprove"] is True, at_threshold
    assert at_threshold["requiresHumanReview"] is False, at_threshold
    document = report["document"]
    assert document["ok"] is True, document
    assert document["composite"] == 77, document
    assert document["requiresHumanReview"] is False, document


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
