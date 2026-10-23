"""P-347 — the self-critique prompt's mandated tests.

The CI is bun-only, so the python ids drive the real module through the bun
harness (packages/core/src/__tests__/fixtures/self-critique-harness.ts) and
assert on its report: the prompt must produce schema-valid output, and the
self scores must correlate directionally with the recorded human rubric scores.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
HARNESS = REPO_ROOT / "packages/core/src/__tests__/fixtures/self-critique-harness.ts"
COMPARISON = REPO_ROOT / "eval/self_critique/comparison.json"

_REPORT: dict | None = None


def run_harness() -> dict:
    """Run the harness once and return its report."""
    global _REPORT
    if _REPORT is None:
        proc = subprocess.run(
            ["bun", str(HARNESS)],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
        )
        line = next(
            (item for item in proc.stdout.splitlines() if item.startswith("SELF_CRITIQUE ")),
            None,
        )
        if line is None:
            raise AssertionError(
                f"the harness produced no report (exit {proc.returncode}): "
                f"{proc.stdout}\n{proc.stderr}"
            )
        _REPORT = json.loads(line[len("SELF_CRITIQUE ") :])
    return _REPORT


def test_prompt_output_valid() -> None:
    """The prompt renders and its reply parses into a schema-valid document."""
    report = run_harness()
    assert report["promptPreview"] is True, report
    assert isinstance(report["promptVersion"], str) and len(report["promptVersion"]) == 12, report
    valid = report["valid"]
    assert valid["ok"] is True, valid
    assert valid["selfConfidence"] == 82, valid
    assert valid["flags"] == ["helper extraction may be unnecessary"], valid
    invalid = report["invalid"]
    assert invalid["noJson"] is True, invalid
    assert invalid["outOfRange"] is True, invalid
    assert invalid["missingField"] is True, invalid
    assert invalid["field"] == "confidence.selfCritique", invalid
    mapped = report["mapped"]
    assert mapped["self_confidence"] == 82, mapped
    assert mapped["wiring_correctness"] == 100, mapped
    assert report["mock"]["ok"] is True, report["mock"]


def test_manual_correlation() -> None:
    """The self scores rank-correlate with the recorded human rubric scores."""
    report = run_harness()
    correlation = report["correlation"]
    # The set is a recorded reference (10 cases); the live ten-proposal
    # inspection needs an AI provider key and human raters and is deferred,
    # which the artifact states itself rather than being claimed here.
    assert correlation["cases"] == 10, correlation
    assert correlation["overall"] > 0.8, correlation
    assert correlation["wiring"] > 0.5, correlation
    assert correlation["deferred"] is True, correlation
    assert "needs an AI provider key" in correlation["provenance"], correlation
    written = json.loads(COMPARISON.read_text(encoding="utf-8"))
    assert written["correlation"]["overall"] == correlation["overall"], written


def main() -> int:
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
