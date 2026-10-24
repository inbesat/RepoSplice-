"""P-354 - the calibration check tests (the mandated ids).

The CI is bun-only, so the python tests drive the real implementation through a
bun harness (packages/core/src/__tests__/fixtures/calibration-harness.ts) and
assert on its report. The harness measures the RECORDED reference set and writes
eval/calibration/report.json; the live Epic 16 corpus check is deferred (it needs
Docker, an AI provider key and human raters), and the artifact's provenance says
so - a missing measurement is never a zero.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
HARNESS = REPO_ROOT / "packages" / "core" / "src" / "__tests__" / "fixtures" / "calibration-harness.ts"
ARTIFACT = REPO_ROOT / "eval" / "calibration" / "report.json"

THRESHOLD = 0.5

_REPORT: dict | None = None


def run_harness() -> dict:
    """Run the harness once and return its report."""
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
        (item for item in proc.stdout.splitlines() if item.startswith("CALIBRATION ")),
        None,
    )
    if line is None:
        raise AssertionError(
            f"the harness produced no report (exit {proc.returncode}): "
            f"{proc.stdout}\n{proc.stderr}"
        )
    _REPORT = json.loads(line[len("CALIBRATION ") :])
    return _REPORT


def test_correlation_computed() -> None:
    """Both coefficients are computed over the recorded samples."""
    report = run_harness()
    assert report["samples"] >= 2, report
    assert isinstance(report["pearson"], (int, float)), report
    assert isinstance(report["spearman"], (int, float)), report
    assert -1 <= report["pearson"] <= 1, report
    assert -1 <= report["spearman"] <= 1, report
    assert report["primary"] == "spearman", report
    assert report["threshold"] == THRESHOLD, report
    scatter = report["scatter"]
    assert len(scatter) == report["samples"], report
    for point in scatter:
        assert set(["id", "selfConfidence", "humanRubric", "humanConfidence"]).issubset(point), point
    assert report["perEcosystem"], report


def test_report_generated() -> None:
    """The artifact is written and matches the report (and admits the deferral)."""
    report = run_harness()
    assert ARTIFACT.exists(), f"the artifact was not written: {ARTIFACT}"
    written = json.loads(ARTIFACT.read_text(encoding="utf-8"))
    assert written["kind"] == "calibration-report", written
    assert written["spearman"] == report["spearman"], written
    assert written["samples"] == report["samples"], written
    assert written["threshold"] == THRESHOLD, written
    assert written["scatter"] == report["scatter"], written
    assert written["perEcosystem"] == report["perEcosystem"], written
    assert isinstance(written["provenance"], str) and written["provenance"], written


def test_critical_flag() -> None:
    """The critical branch is real: the recorded set clears it, the inverted one fires it."""
    report = run_harness()
    assert report["critical"] is False, report
    assert report["requiresRecalibration"] is False, report
    inversion = report["decorrelated"]
    assert inversion["samples"] >= 2, inversion
    assert inversion["spearman"] < 0, inversion
    assert inversion["spearman"] < THRESHOLD, inversion
    assert inversion["critical"] is True, inversion
    assert inversion["requiresRecalibration"] is True, inversion
    assert report["artifactSpearman"] == report["spearman"], report


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
            print(f"FAIL {name}: {error}")
            failures += 1
        else:
            print(f"ok {name}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
