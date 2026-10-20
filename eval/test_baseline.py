"""P-327 — the baseline run: the harness results become the baseline metrics.

The two mandated ids drive the REAL `stitch eval baseline` work function
through a bun harness (the CI is bun-only), the P-323/P-324/P-326 pattern.
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
HARNESS = (
    REPO_ROOT
    / "packages"
    / "cli"
    / "src"
    / "__tests__"
    / "fixtures"
    / "eval-baseline-harness.ts"
)


def corpus_pair(pair_id: str) -> dict[str, object]:
    """A corpus entry that validates against the P-320 pair schema."""
    return {
        "pair_id": pair_id,
        "repo_a_url": "https://github.com/o/a",
        "repo_b_url": "https://github.com/o/b",
        "repo_a_sha": "a" * 40,
        "repo_b_sha": "b" * 40,
        "extract_paths_a": ["./"],
        "extract_paths_b": ["./"],
        "ecosystem": "js",
        "license_a": "MIT",
        "license_b": "MIT",
        "expected_outcome": "clean",
    }


def rubric(pair_id: str, score: int) -> dict[str, object]:
    """A valid SemanticRubric (the P-325 schema)."""
    return {
        "pair_id": pair_id,
        "rater": "rater-a",
        "wiring_correctness": score,
        "unnecessary_changes": score,
        "respects_patterns": score,
        "notes": "a note",
    }


def result(pair_id: str, **fields: object) -> dict[str, object]:
    """A harness result JSON (the P-323 result shape)."""
    base: dict[str, object] = {
        "pair_id": pair_id,
        "status": "succeeded",
        "build_pass": True,
        "build_logs": ["build ok"],
        "test_logs": ["tests ok"],
        "rubric_score": None,
        "resolve_rate": None,
        "tokens": 12,
        "cost": 0.01,
        "duration": 100,
        "error_code": None,
        "error_message": None,
    }
    base.update(fields)
    return base


def run_baseline(directory: Path) -> tuple[int, dict[str, object]]:
    """Run the real baseline command over a fixture corpus + results."""
    corpus_dir = directory / "corpus"
    results_dir = directory / "results"
    corpus_dir.mkdir(parents=True, exist_ok=True)
    results_dir.mkdir(parents=True, exist_ok=True)
    (corpus_dir / "pairs.json").write_text(
        json.dumps([corpus_pair("p1"), corpus_pair("p2")]), encoding="utf-8"
    )
    (results_dir / "p1.json").write_text(
        json.dumps(result("p1", human_scores=[rubric("p1", 4)])), encoding="utf-8"
    )
    (results_dir / "p2.json").write_text(
        json.dumps(
            result(
                "p2",
                status="failed",
                build_pass=False,
                error_code="DEPENDENCY_CONFLICT",
                human_scores=[rubric("p2", 2)],
            )
        ),
        encoding="utf-8",
    )
    artifact = directory / "baseline.json"
    completed = subprocess.run(
        [
            "bun",
            str(HARNESS),
            "--corpus",
            str(corpus_dir),
            "--result-dir",
            str(results_dir),
            "--out",
            str(artifact),
        ],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )
    line = next(
        (item for item in completed.stdout.splitlines() if item.startswith("BASELINE ")),
        None,
    )
    if line is None:
        raise AssertionError(
            f"the baseline harness printed no BASELINE line\n"
            f"stdout: {completed.stdout}\nstderr: {completed.stderr}"
        )
    report = json.loads(line[len("BASELINE ") :])
    if not artifact.exists():
        raise AssertionError(f"the baseline artifact was not written: {artifact}")
    metrics = json.loads(artifact.read_text(encoding="utf-8"))
    return int(report.get("exit", 1)), metrics


def test_all_pairs_completed() -> None:
    """Every corpus pair carries a result, so the run is complete."""
    with tempfile.TemporaryDirectory() as raw:
        code, metrics = run_baseline(Path(raw))
    assert code == 0, f"the baseline run reported {code}"
    assert metrics["pairs"] == 2
    scored = {pair["pair_id"] for pair in metrics["per_pair"]}
    assert scored == {"p1", "p2"}


def test_metrics_documented() -> None:
    """The metrics carry the build-pass rate, the rubric average, the resolve
    rate and the go/no-go decision with its reasons."""
    with tempfile.TemporaryDirectory() as raw:
        _code, metrics = run_baseline(Path(raw))
    assert metrics["build_pass_rate"] == 0.5
    assert metrics["rubric_avg"] == 3.0
    assert metrics["resolve_rate"] == 0.5
    assert metrics["decision"] in {"go", "no-go", "pending"}
    assert metrics["reasons"], "the decision needs a reason"
    assert metrics["categories"]["resolution"] == 1


if __name__ == "__main__":
    failures = 0
    for name, test in sorted(globals().items()):
        if not name.startswith("test_") or not callable(test):
            continue
        try:
            test()
        except Exception as error:  # noqa: BLE001 - the runner reports the failure
            print(f"FAIL {name}: {error}")
            failures += 1
        else:
            print(f"ok {name}")
    sys.exit(1 if failures else 0)
