"""P-328 — the CI regression gate: a good run passes, a degraded run is blocked.

The gate compares the COMPOSITE of a run against the last baseline; a drop of
more than the threshold (5 points by default) fails the job. The bun harness
drives the real core module; this test only feeds it two metric files.
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
HARNESS = REPO_ROOT / "packages/core/src/__tests__/fixtures/ci-gate-harness.ts"


def metrics(build_pass_rate: float, resolve_rate: float, rubric_avg: float | None) -> dict:
    """One baseline-shaped metrics document (the fields the gate reads)."""
    return {
        "version": 1,
        "generated_at": "2026-10-21T00:00:00.000Z",
        "pairs": 20,
        "rated": 20 if rubric_avg is not None else 0,
        "build_pass_count": int(build_pass_rate * 20),
        "build_pass_rate": build_pass_rate,
        "rubric_avg": rubric_avg,
        "resolved_count": int(resolve_rate * 20),
        "resolve_rate": resolve_rate,
        "decision": "go",
        "reasons": [],
        "categories": {
            "resolution": 0,
            "build": 0,
            "test": 0,
            "license": 0,
            "timeout": 0,
            "other": 0,
        },
        "per_pair": [],
    }


def run_gate(current: dict, baseline: dict) -> tuple[int, dict]:
    """Run the harness over the two metric files; return (exit code, verdict)."""
    with tempfile.TemporaryDirectory() as raw:
        directory = Path(raw)
        current_path = directory / "current.json"
        baseline_path = directory / "baseline.json"
        current_path.write_text(json.dumps(current), encoding="utf-8")
        baseline_path.write_text(json.dumps(baseline), encoding="utf-8")
        completed = subprocess.run(
            [
                "bun",
                str(HARNESS),
                "--current",
                str(current_path),
                "--baseline",
                str(baseline_path),
            ],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
        )
        line = next(
            (row for row in completed.stdout.splitlines() if row.startswith("GATE ")),
            None,
        )
        if line is None:
            raise AssertionError(
                "the gate harness printed no verdict\n"
                f"stdout: {completed.stdout}\nstderr: {completed.stderr}"
            )
        return completed.returncode, json.loads(line[len("GATE ") :])


def test_gate_passes_on_good() -> None:
    """A run that matches the baseline passes the gate."""
    baseline = metrics(0.8, 0.6, 4.0)
    code, verdict = run_gate(metrics(0.8, 0.6, 4.0), baseline)
    assert code == 0, verdict
    assert verdict["passed"] is True
    assert verdict["delta"] == 0
    assert verdict["composite"] == verdict["baseline_composite"]


def test_gate_fails_on_regression() -> None:
    """A degraded run (the spec's broken-prompt case) is blocked."""
    baseline = metrics(0.8, 0.6, 4.0)
    code, verdict = run_gate(metrics(0.2, 0.0, 2.0), baseline)
    assert code == 1, verdict
    assert verdict["passed"] is False
    assert verdict["delta"] > 0
    assert verdict["threshold"] == 5


if __name__ == "__main__":
    failures = 0
    for name, test in sorted(globals().items()):
        if not name.startswith("test_") or not callable(test):
            continue
        try:
            test()
            print(f"ok {name}")
        except Exception as error:  # noqa: BLE001 - the runner reports every failure
            failures += 1
            print(f"FAIL {name}: {error}")
    sys.exit(1 if failures else 0)
