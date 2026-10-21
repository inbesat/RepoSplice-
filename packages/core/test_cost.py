# P-330 — the cost/token tracking tests.
#
# The cost numbers come from the P-145 audit rows, so these tests drive the
# REAL core module through a bun harness (the CI is bun-only) and assert on
# what it reports: the token totals, the cost arithmetic against the model
# registry's pricing, and the budget alert.
#
# Run standalone: python packages/core/test_cost.py
# Run with pytest:  python -m pytest packages/core/test_cost.py -q

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
HARNESS = REPO_ROOT / "packages" / "core" / "src" / "__tests__" / "fixtures" / "cost-harness.ts"


def run_cost() -> dict:
    """Run the bun harness and return its report."""
    proc = subprocess.run(
        ["bun", str(HARNESS)],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )
    for line in proc.stdout.splitlines():
        if line.startswith("COST "):
            return json.loads(line[len("COST ") :])
    raise AssertionError(
        "the cost harness printed no COST line\n"
        f"exit={proc.returncode}\nstdout={proc.stdout}\nstderr={proc.stderr}"
    )


def test_tokens_recorded():
    """The audited provider calls add up to the run's token totals."""
    report = run_cost()
    usage = report["usage"]
    assert usage["calls"] == 2, usage
    assert usage["inputTokens"] == 3000, usage
    assert usage["outputTokens"] == 1500, usage
    assert usage["tokensTotal"] == 4500, usage
    assert abs(usage["costUsd"] - 0.03) < 1e-9, usage
    assert len(usage["models"]) == 1, usage
    assert len(usage["providers"]) == 1, usage


def test_cost_calculation():
    """A million tokens cost the registry price; an unknown model costs zero."""
    report = run_cost()
    price = report["price"]
    assert price is not None, report
    expected = (1_000_000 * price["input"] + 1_000_000 * price["output"]) / 1_000_000
    assert abs(report["priced"] - expected) < 1e-9, report
    # a model that is not in the registry prices at zero - the tokens are
    # still counted, the cost is simply unknown
    assert report["unknown"] == 0, report
    # the cost of one successful merge
    assert abs(report["per_success"] - 0.03) < 1e-9, report
    assert report["per_success_none"] is None, report


def test_budget_alert():
    """The budget alert fires only when the run is over the threshold."""
    report = run_cost()
    budget = report["budget"]
    # 0 = off (the config's maxCostUsd convention)
    assert budget["off"]["exceeded"] is False, budget
    assert "off" in budget["off"]["message"], budget
    # a budget above the run cost passes
    assert budget["within"]["exceeded"] is False, budget
    # a budget below the run cost fires, and the message names the numbers
    assert budget["over"]["exceeded"] is True, budget
    assert "EXCEEDS" in budget["over"]["message"], budget


def main() -> int:
    failures = 0
    for name, test in sorted(globals().items()):
        if not name.startswith("test_") or not callable(test):
            continue
        try:
            test()
        except Exception as error:  # noqa: BLE001 - the runner reports everything
            print(f"FAIL {name}: {error}")
            failures += 1
        else:
            print(f"ok {name}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
