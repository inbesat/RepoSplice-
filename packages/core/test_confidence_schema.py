"""P-346 — the SemanticConfidence schema's mandated tests.

The CI is bun-only, so the python ids drive the real schema module through the
bun harness (packages/core/src/__tests__/fixtures/confidence-schema-harness.ts)
and assert on its report.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
HARNESS = (
    REPO_ROOT / "packages" / "core" / "src" / "__tests__" / "fixtures" / "confidence-schema-harness.ts"
)

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
    )
    line = next((row for row in proc.stdout.splitlines() if row.startswith("CONFIDENCE ")), None)
    if line is None:
        raise AssertionError(
            f"the harness printed no CONFIDENCE line (exit {proc.returncode}): "
            f"{proc.stdout}\n{proc.stderr}"
        )
    _REPORT = json.loads(line[len("CONFIDENCE ") :])
    return _REPORT


def test_schema_valid() -> None:
    """The assembled document validates, and the invalid shapes do not."""
    report = run_harness()
    assert report["valid"]["ok"] is True, report["valid"]
    assert report["built"]["composite"] == 89, report["built"]
    assert report["built"]["rationale"], report["built"]
    invalid = report["invalid"]
    assert invalid["selfConfidence"] is True, invalid
    assert invalid["sandboxPass"] is True, invalid
    assert invalid["emptyRationale"] is True, invalid


def test_weighting_formula() -> None:
    """The default weights sum to one and produce the documented composite."""
    report = run_harness()
    assert report["components"] == [
        "sandbox_pass",
        "self_confidence",
        "resolver_confidence",
        "license_risk",
        "test_coverage",
    ], report["components"]
    assert report["weightsSum"] == 1, report["weights"]
    assert report["weighted"]["composite"] == 89, report["weighted"]
    assert report["invalid"]["weightsSum"] is True, report["invalid"]
    assert report["invalid"]["negativeWeight"] is True, report["invalid"]
    # The P-325 rubric compatibility is recorded, not implied.
    assert report["rubric"]["dimensions"] == [
        "respects_patterns",
        "unnecessary_changes",
        "wiring_correctness",
    ], report["rubric"]


def test_clamp_bounds() -> None:
    """The composite never leaves 0-100."""
    report = run_harness()
    assert report["clamp"]["worst"] == 0, report["clamp"]
    assert report["clamp"]["best"] == 100, report["clamp"]
    assert report["clamp"]["sweepInBounds"] is True, report["clamp"]
    assert report["rubric"]["score"] == 5, report["rubric"]


def main() -> int:
    """Run every test in this file and report the result."""
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
