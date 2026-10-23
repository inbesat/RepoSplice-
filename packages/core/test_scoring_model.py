"""P-349 — the composite scoring model's mandated tests.

The CI is bun-only, so the python ids drive the real model through a bun
harness (packages/core/src/__tests__/fixtures/scoring-model-harness.ts) and
assert on its report.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
HARNESS = REPO_ROOT / "packages/core/src/__tests__/fixtures/scoring-model-harness.ts"

_REPORT: dict | None = None

FACTORS = ("sandbox_pass", "self_confidence", "resolver_confidence", "license_risk", "test_coverage")
DOCUMENTED_DEFAULTS = {
    "sandbox_pass": 0.3,
    "self_confidence": 0.25,
    "resolver_confidence": 0.2,
    "license_risk": 0.15,
    "test_coverage": 0.1,
}


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
        if line.startswith("SCORING "):
            _REPORT = json.loads(line[len("SCORING ") :])
            return _REPORT
    raise AssertionError(
        f"the harness printed no SCORING line (exit {proc.returncode})\n"
        f"{proc.stdout}\n{proc.stderr}"
    )


def test_default_weights() -> None:
    """The shipped weights are the documented P-349 set and sum to one."""
    report = run_harness()
    defaults = report["defaults"]
    assert set(defaults) == set(FACTORS), defaults
    for factor, expected in DOCUMENTED_DEFAULTS.items():
        assert abs(defaults[factor] - expected) < 1e-9, (factor, defaults[factor], expected)
    assert abs(report["sum"] - 1) <= report["tolerance"], report["sum"]
    assert report["rationaleComplete"] is True, report["rationale"]
    assert set(report["rationale"]) == set(FACTORS), report["rationale"]
    assert list(report["order"]) == list(FACTORS), report["order"]
    # the strong fixture: 30 + 20 + 18 + 13.5 + 7 = 88.5 -> 89
    assert report["strong"] == 89, report["strong"]


def test_custom_weights() -> None:
    """A caller-supplied weight set is honoured; an unusable one is refused."""
    report = run_harness()
    # {sandbox .5, self .5} over {1, 33.2} = 66.6 -> 67
    assert report["custom"] == 67, report["custom"]
    refusal = report["refusal"]
    assert refusal is not None, report
    assert refusal["code"] == "CONFIG_ERROR", refusal
    assert refusal["field"] == "confidence.weights", refusal
    negative = report["negativeRefusal"]
    assert negative is not None, report
    assert negative["code"] == "CONFIG_ERROR", negative
    assert negative["field"] == "confidence.weights", negative
    assert "license_risk" in negative["message"], negative


def test_explain_output() -> None:
    """The breakdown names every factor, its weight and the composite."""
    report = run_harness()
    text = report["explain"]
    assert text, report
    for factor in FACTORS:
        assert factor in text, (factor, text)
    assert "composite 89/100" in text, text
    assert "30%" in text, text
    assert "rubric band" in text, text
    # one line per factor plus the weighted sum and the rubric band
    assert report["explainLines"] >= len(FACTORS) + 2, report["explainLines"]


def test_deterministic() -> None:
    """The same inputs always produce the same score and the same text."""
    report = run_harness()
    assert report["deterministic"] is True, report
    assert report["bounds"]["worst"] == 0, report["bounds"]
    assert report["bounds"]["best"] == 100, report["bounds"]


def main() -> int:
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
