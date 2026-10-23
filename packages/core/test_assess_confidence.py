"""P-348 — the `assess_confidence` tool's mandated tests.

The CI is bun-only, so the python ids drive the real module through a bun
harness (packages/core/src/__tests__/fixtures/assess-confidence-harness.ts)
and assert on its report: the automatic invocation, the five components, the
composite calculation and the event-bus emission.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
HARNESS = REPO_ROOT / "packages/core/src/__tests__/fixtures/assess-confidence-harness.ts"

COMPONENT_KEYS = (
    "sandbox_pass",
    "self_confidence",
    "resolver_confidence",
    "license_risk",
    "test_coverage",
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
    for line in proc.stdout.splitlines():
        if line.startswith("ASSESS_CONFIDENCE "):
            _REPORT = json.loads(line[len("ASSESS_CONFIDENCE ") :])
            return _REPORT
    raise AssertionError(
        f"the harness printed no ASSESS_CONFIDENCE line (exit {proc.returncode}): "
        f"{proc.stdout}\n{proc.stderr}"
    )


def test_auto_invocation() -> None:
    report = run_harness()
    assert report["autoInvocation"]["ok"] is True, report
    assert report["autoInvocation"]["tool"] == "assess_confidence", report
    # The wrapped proposal tool ran the assessment and still returned its value.
    assert report["ok"] is True, report
    assert report["proposalId"] == "proposal-1", report


def test_all_components_populated() -> None:
    report = run_harness()
    components = report["components"]
    assert components is not None, report
    assert tuple(components.keys()) == COMPONENT_KEYS, report
    assert components["sandbox_pass"] == 1, report
    assert components["self_confidence"] == 82, report
    assert components["resolver_confidence"] == 60, report
    assert components["license_risk"] == 40, report
    assert components["test_coverage"] == 50, report


def test_composite_calculation() -> None:
    report = run_harness()
    # .30*100 + .20*82 + .25*60 + .15*60 + .10*50 = 75.4 -> 75
    assert report["composite"] == 75, report
    assert report["flags"] == [], report
    assert "75/100" in report["rationale"], report
    weights = report["weights"]
    assert abs(sum(weights.values()) - 1.0) < 1e-6, report
    mapping = report["tagMapping"]
    assert mapping["lsp-high"] == 100, report
    assert mapping["heuristic-medium"] == 60, report
    assert mapping["unresolved"] == 0, report
    assert mapping["none"] == 0, report


def test_event_bus_emission() -> None:
    report = run_harness()
    emitted = report["emitted"]
    assert len(emitted) >= 1, report
    assert emitted[0]["tool"] == "assess_confidence", report
    assert emitted[0]["percent"] == 75, report
    assert emitted[0]["hasDetail"] is True, report
    stored = report["stored"]
    assert len(stored) >= 1, report
    assert stored[0]["proposalId"] == "proposal-1", report
    prompt = report["prompt"]
    assert prompt["name"] == "self-critique", report
    assert len(prompt["version"]) == 12, report
    # A missing measurement is never a zero: the tool refuses instead.
    assert report["missingPort"]["code"] == "CONFIG_ERROR", report
    assert report["missingPort"]["field"] == "confidence.ports", report


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
