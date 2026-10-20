"""P-323 — the eval harness runner tests (mandated ids).

The runner is TypeScript; these tests drive the real runner through the
fake-port harness script (packages/core/src/__tests__/fixtures/eval-harness.ts)
and check the emitted artifacts:

* test_single_pair          - one pair -> one result file + the summary
* test_parallel_execution  - the concurrency bound is respected
* test_result_schema_valid  - the emitted result validates against the
                              committed result JSON Schema
"""

import json
import subprocess
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
HARNESS = REPO_ROOT / "packages" / "core" / "src" / "__tests__" / "fixtures" / "eval-harness.ts"
FIXTURE_CORPUS = REPO_ROOT / "packages" / "core" / "src" / "__tests__" / "fixtures" / "eval-corpus"
RESULT_SCHEMA = REPO_ROOT / "eval" / "corpus" / "result-schema.json"

sys.path.insert(0, str(REPO_ROOT / "eval" / "scripts"))
import validate_corpus  # noqa: E402


def _run_harness(corpus: Path, output_dir: Path, parallel: int = 1) -> subprocess.CompletedProcess:
    return subprocess.run(
        [
            "bun",
            str(HARNESS),
            "--corpus",
            str(corpus),
            "--output-dir",
            str(output_dir),
            "--parallel",
            str(parallel),
        ],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
    )


def _fixture_pairs() -> list[dict]:
    pairs = json.loads((FIXTURE_CORPUS / "pairs.json").read_text(encoding="utf-8"))
    return pairs


def test_single_pair() -> None:
    """One pair -> one per-pair result file plus the run summary."""
    pairs = _fixture_pairs()
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        corpus = base / "pairs.json"
        corpus.write_text(json.dumps([pairs[0]]), encoding="utf-8")
        out = base / "out"
        done = _run_harness(corpus, out)
        assert done.returncode == 0, done.stderr
        summary = json.loads((out / "summary.json").read_text(encoding="utf-8"))
        assert summary["pairs"] == 1
        assert summary["succeeded"] == 1
        assert summary["failed"] == 0
        result_file = out / f"{pairs[0]['pair_id']}.json"
        assert result_file.exists(), "the per-pair result file is missing"
        result = json.loads(result_file.read_text(encoding="utf-8"))
        for field in (
            "pair_id",
            "status",
            "build_pass",
            "rubric_score",
            "resolve_rate",
            "tokens",
            "cost",
            "duration",
            "error_code",
            "error_message",
        ):
            assert field in result, f"the result is missing {field}"
        assert result["status"] == "succeeded"
        assert result["error_code"] is None


def test_parallel_execution() -> None:
    """The concurrency bound is respected (and the run still finishes)."""
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        out = base / "out"
        serial = _run_harness(FIXTURE_CORPUS, out, parallel=1)
        assert serial.returncode == 0, serial.stderr
        summary = json.loads((out / "summary.json").read_text(encoding="utf-8"))
        assert summary["max_concurrency"] == 1
        assert summary["pairs"] == 2

        parallel_out = base / "out-parallel"
        parallel = _run_harness(FIXTURE_CORPUS, parallel_out, parallel=2)
        assert parallel.returncode == 0, parallel.stderr
        parallel_summary = json.loads((parallel_out / "summary.json").read_text(encoding="utf-8"))
        assert parallel_summary["max_concurrency"] <= 2
        assert parallel_summary["parallel"] == 2
        assert parallel_summary["succeeded"] == 2


def test_result_schema_valid() -> None:
    """The emitted result validates against the committed result schema."""
    schema = json.loads(RESULT_SCHEMA.read_text(encoding="utf-8"))
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        out = base / "out"
        done = _run_harness(FIXTURE_CORPUS, out)
        assert done.returncode == 0, done.stderr
        for path in sorted(out.glob("*.json")):
            if path.name == "summary.json":
                continue
            result = json.loads(path.read_text(encoding="utf-8"))
            errors = validate_corpus.validate_instance(schema, result, schema)
            assert errors == [], errors


if __name__ == "__main__":
    failures = 0
    for name, function in sorted(globals().items()):
        if name.startswith("test_") and callable(function):
            try:
                function()
                print(f"ok {name}")
            except AssertionError as error:
                failures += 1
                print(f"FAIL {name}: {error}")
    raise SystemExit(1 if failures else 0)
