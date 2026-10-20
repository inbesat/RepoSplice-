# P-329 — the per-ecosystem breakdown: the aggregation and the CI summary
# table. The real work lives in the core module (packages/core/src/eval/
# report.ts); this file drives it through the bun harness so the CI (which
# is bun-only) and a fresh clone both exercise the same code.
#
# Run it standalone:  python packages/core/test_report.py
# Or under pytest:    python -m pytest packages/core/test_report.py -q

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
HARNESS = REPO_ROOT / "packages" / "core" / "src" / "__tests__" / "fixtures" / "report-harness.ts"

RUBRIC = {
    "wiring_correctness": 4,
    "unnecessary_changes": 4,
    "respects_patterns": 4,
    "notes": "the wiring holds",
}


def _result(pair_id: str, ecosystem: str, build_pass: bool, score: int, error_code: str | None = None) -> dict:
    rubric = dict(RUBRIC)
    rubric["pair_id"] = pair_id
    rubric["rater"] = "rater-a"
    for key in ("wiring_correctness", "unnecessary_changes", "respects_patterns"):
        rubric[key] = score
    return {
        "pair_id": pair_id,
        "ecosystem": ecosystem,
        "status": "succeeded" if build_pass else "failed",
        "build_pass": build_pass,
        "rubric_score": float(score),
        "resolve_rate": 1.0 if build_pass else 0.0,
        "tokens": 100,
        "cost": 0.01,
        "duration": 1000,
        "error_code": error_code,
        "human_scores": [rubric],
    }


def write_results(directory: Path) -> None:
    """Three pairs: two js (one builds, one fails) and one python."""
    (directory / "js-1.json").write_text(
        json.dumps(_result("js-1", "js", True, 4)), encoding="utf-8"
    )
    (directory / "js-2.json").write_text(
        json.dumps(_result("js-2", "js", False, 2, "DEPENDENCY_CONFLICT")), encoding="utf-8"
    )
    (directory / "py-1.json").write_text(
        json.dumps(_result("py-1", "python", True, 5)), encoding="utf-8"
    )


def run_report(directory: Path) -> tuple[dict, str]:
    """Drive the bun harness over the results directory; return (report, table)."""
    proc = subprocess.run(
        ["bun", str(HARNESS), "--result-dir", str(directory)],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )
    line = next((row for row in proc.stdout.splitlines() if row.startswith("REPORT ")), None)
    if line is None:
        raise AssertionError(
            f"the harness printed no REPORT line (exit {proc.returncode})\n"
            f"stdout: {proc.stdout}\nstderr: {proc.stderr}"
        )
    payload = json.loads(line[len("REPORT ") :])
    return payload["report"], payload["table"]


def _by_ecosystem(report: dict) -> dict:
    return {entry["ecosystem"]: entry for entry in report["ecosystems"]}


def test_ecosystem_aggregation() -> None:
    with tempfile.TemporaryDirectory() as raw:
        directory = Path(raw)
        write_results(directory)
        report, _table = run_report(directory)
    rows = _by_ecosystem(report)
    # every ecosystem is listed, so the CI table always has the same rows
    assert sorted(rows) == ["go", "js", "python", "rust"]
    assert rows["js"]["pairs"] == 2
    assert rows["js"]["build_pass_rate"] == 0.5
    assert rows["js"]["rubric_avg"] == 3
    assert rows["js"]["categories"]["resolution"] == 1
    assert rows["python"]["pairs"] == 1
    assert rows["python"]["build_pass_rate"] == 1
    assert rows["python"]["rubric_avg"] == 5
    # an ecosystem nobody ran is empty, never a fake zero
    assert rows["rust"]["pairs"] == 0
    assert rows["rust"]["build_pass_rate"] is None
    assert rows["rust"]["rubric_avg"] is None
    assert report["totals"]["pairs"] == 3


def test_ci_summary_table() -> None:
    with tempfile.TemporaryDirectory() as raw:
        directory = Path(raw)
        write_results(directory)
        _report, table = run_report(directory)
    assert "| ecosystem" in table
    for ecosystem in ("js", "python", "go", "rust"):
        assert f"| {ecosystem} " in table
    # the totals row closes the table
    assert "| all " in table
    assert table.count("\n") >= 6


def main() -> int:
    failures = 0
    for name, test in sorted(globals().items()):
        if not name.startswith("test_"):
            continue
        try:
            test()
        except Exception as error:  # noqa: BLE001 - the runner reports every failure
            print(f"FAIL {name}: {error}")
            failures += 1
        else:
            print(f"ok {name}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
