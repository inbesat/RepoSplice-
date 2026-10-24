"""P-355 — the mandated recalibration tests.

They drive the real loop through the bun harness
(packages/core/src/__tests__/fixtures/recalibration-harness.ts), which measures
the recorded reference set, an inverted set a flipping candidate rescues, and an
inverted set nothing rescues.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
HARNESS = REPO_ROOT / "packages/core/src/__tests__/fixtures/recalibration-harness.ts"
THRESHOLD = 0.5
FINAL_WEIGHTS = {
    "sandbox_pass": 0.3,
    "self_confidence": 0.25,
    "resolver_confidence": 0.2,
    "license_risk": 0.15,
    "test_coverage": 0.1,
}

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
    for line in proc.stdout.splitlines():
        if line.startswith("RECALIBRATION "):
            _REPORT = json.loads(line[len("RECALIBRATION ") :])
            return _REPORT
    raise AssertionError(
        f"the harness printed no RECALIBRATION line (exit {proc.returncode})\n"
        f"{proc.stdout}\n{proc.stderr}"
    )


def test_iteration_improves_correlation() -> None:
    """A candidate that flips an inverted set really improves the correlation."""
    report = run_harness()
    improved = report["improved"]
    assert improved["decision"] == "recalibrated", improved
    assert improved["attempts"], improved
    last = improved["attempts"][-1]
    assert last["improved"] is True, last
    assert last["meets"] is True, last
    assert improved["frozen"]["spearman"] is not None, improved
    assert improved["frozen"]["spearman"] >= THRESHOLD, improved
    assert improved["frozen"]["spearman"] > improved["baseline"]["spearman"], improved
    assert report["threshold"] == THRESHOLD, report


def test_final_frozen() -> None:
    """The validated baseline freezes the prompt hash and the finalized weights."""
    report = run_harness()
    recorded = report["recorded"]
    assert recorded["decision"] == "validated", recorded
    assert recorded["attempts"] == [], recorded
    frozen = recorded["frozen"]
    version = frozen["promptVersion"]
    assert isinstance(version, str) and len(version) == 12, frozen
    int(version, 16)  # a hex digest, so the content hash is real
    assert frozen["weights"] == FINAL_WEIGHTS, frozen
    assert frozen["spearman"] is not None and frozen["spearman"] >= THRESHOLD, frozen
    assert recorded["samples"] >= 2, recorded
    assert report["maxIterations"] >= 1, report
    limited = report["limited"]
    assert limited["decision"] == "limited", limited
    assert "P-350" in limited["reason"], limited


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
