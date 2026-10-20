"""P-326 — the rater review tool's contract (the mandated ids).

The tool is interactive, so the python side drives the REAL work function
through a bun harness with a fake prompt (the P-323/P-324 pattern) and then
asserts on the result JSON the rater's answers were written to.
"""

import json
import subprocess
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
HARNESS = (
    REPO_ROOT
    / "packages"
    / "cli"
    / "src"
    / "__tests__"
    / "fixtures"
    / "eval-rate-harness.ts"
)
CLI = REPO_ROOT / "packages" / "cli" / "src" / "index.ts"
PAIR_ID = "fixture-js-1"

RESULT = {
    "pair_id": PAIR_ID,
    "status": "succeeded",
    "build_pass": True,
    "build_logs": ["build ok"],
    "test_logs": ["tests ok"],
    "tokens": 12,
    "cost": 0.01,
    "duration": 100,
    "error_code": None,
    "error_message": None,
}


def write_result(directory: Path) -> Path:
    """Lay down the harness result the rater will score."""
    path = directory / f"{PAIR_ID}.json"
    path.write_text(json.dumps(RESULT, indent=2) + "\n", encoding="utf-8")
    return path


def run_rate(directory: Path) -> dict:
    """Drive the real rating work function and return its report."""
    completed = subprocess.run(
        [
            "bun",
            str(HARNESS),
            "--result-dir",
            str(directory),
            "--pair",
            PAIR_ID,
            "--rater",
            "rater-x",
        ],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )
    line = next(
        (row for row in completed.stdout.splitlines() if row.startswith("RATE ")), None
    )
    if line is None:
        raise AssertionError(
            f"the harness printed no RATE line: {completed.stdout!r} {completed.stderr!r}"
        )
    return json.loads(line[len("RATE ") :])


def test_cli_captures_scores():
    """The rater's 1-5 answers become the rubric."""
    with tempfile.TemporaryDirectory() as raw:
        directory = Path(raw)
        write_result(directory)
        report = run_rate(directory)
        assert report["exit"] == 0, report
        rubric = report["rubric"]
        assert rubric is not None, report
        assert rubric["wiring_correctness"] == 4, rubric
        assert rubric["unnecessary_changes"] == 5, rubric
        assert rubric["respects_patterns"] == 4, rubric
        assert rubric["notes"], rubric
        assert rubric["rater"] == "rater-x", rubric
        assert rubric["pair_id"] == PAIR_ID, rubric


def test_json_persistence():
    """The rating is written back to the result JSON, harness data intact."""
    with tempfile.TemporaryDirectory() as raw:
        directory = Path(raw)
        path = write_result(directory)
        report = run_rate(directory)
        assert report["exit"] == 0, report
        saved = json.loads(path.read_text(encoding="utf-8"))
        assert saved["human_rater"] == "rater-x", saved
        human = saved["human_score"]
        assert human["pair_id"] == PAIR_ID, saved
        assert 1 <= human["wiring_correctness"] <= 5, saved
        assert 1 <= human["unnecessary_changes"] <= 5, saved
        assert 1 <= human["respects_patterns"] <= 5, saved
        assert isinstance(human["notes"], str), saved
        # the harness data around the rating is preserved
        assert saved["pair_id"] == PAIR_ID, saved
        assert saved["status"] == "succeeded", saved
        assert saved["build_pass"] is True, saved
        assert saved["build_logs"] == ["build ok"], saved


def test_cli_command_exists():
    """`stitch eval rate` is registered with its options."""
    completed = subprocess.run(
        ["bun", str(CLI), "eval", "rate", "--help"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )
    assert completed.returncode == 0, completed.stderr
    assert "--result-dir" in completed.stdout, completed.stdout


if __name__ == "__main__":
    failures = 0
    for name, test in sorted(globals().items()):
        if name.startswith("test_") and callable(test):
            try:
                test()
                print(f"ok {name}")
            except Exception as error:  # noqa: BLE001 - the runner reports each failure
                failures += 1
                print(f"FAIL {name}: {error}")
    sys.exit(1 if failures else 0)
