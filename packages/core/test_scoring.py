"""P-324 — build-pass scoring tests (the spec's mandated ids).

    core/test_scoring.py::test_build_pass_recorded
    core/test_scoring.py::test_spot_check_matches

The plan's `core/` path maps to `packages/core/` (the same mapping the
P-320 `core/test_eval_schema.py` used). The tests drive the REAL runner
through the bun fixture harness (the CI is bun-only, so the harness keeps the
python side dependency-free) and assert on the emitted per-pair results.

The spot check compares the harness verdict against an INDEPENDENT run of
the same build command. The spec asks for a manual `docker run`; Docker is
not available in every environment (the doctor reports it as optional), so
the reference run is a direct local execution of the very same command. The
production path is unchanged: the sandbox runner (Docker / GitHub Actions).
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
HARNESS = REPO_ROOT / "packages" / "core" / "src" / "__tests__" / "fixtures" / "eval-harness.ts"
SPOT_CORPUS = REPO_ROOT / "packages" / "core" / "src" / "__tests__" / "fixtures" / "eval-corpus-spot"


def run_harness(corpus: Path, output_dir: Path, *extra: str) -> str:
    """Run the bun fixture harness and return its stdout."""
    result = subprocess.run(
        ["bun", str(HARNESS), "--corpus", str(corpus), "--output-dir", str(output_dir), *extra],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        timeout=300,
    )
    if result.returncode != 0:
        raise AssertionError(
            f"harness failed ({result.returncode}):\nstdout: {result.stdout}\nstderr: {result.stderr}"
        )
    return result.stdout


def pair_result(output_dir: Path, pair_id: str) -> dict:
    """The emitted per-pair EvalResult JSON."""
    path = output_dir / f"{pair_id}.json"
    if not path.exists():
        raise AssertionError(f"missing per-pair result: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def test_build_pass_recorded() -> None:
    """The per-pair result records build_pass plus the build/test logs."""
    with tempfile.TemporaryDirectory() as tmp:
        output_dir = Path(tmp) / "out"
        run_harness(SPOT_CORPUS, output_dir)

        passing = pair_result(output_dir, "fixture-spot-js")
        assert passing["status"] == "succeeded", passing
        assert passing["build_pass"] is True, passing
        assert isinstance(passing["build_logs"], list), passing
        assert any("build ok" in line for line in passing["build_logs"]), passing
        assert isinstance(passing["test_logs"], list), passing
        assert any("tests ok" in line for line in passing["test_logs"]), passing

        failing = pair_result(output_dir, "fixture-spot-py")
        assert failing["build_pass"] is False, failing
        assert any("compile error" in line for line in failing["build_logs"]), failing
        # the tests never ran against a broken tree
        assert failing["test_logs"] == [], failing

        built = pair_result(output_dir, "fixture-spot-go")
        assert built["build_pass"] is True, built
        assert any("test failed" in line for line in built["test_logs"]), built


def test_spot_check_matches() -> None:
    """Three pairs: the harness verdict matches an independent manual run."""
    with tempfile.TemporaryDirectory() as tmp:
        output_dir = Path(tmp) / "out"
        stdout = run_harness(SPOT_CORPUS, output_dir, "--spot-check")

        reports = [
            line[len("SPOTCHECK ") :]
            for line in stdout.splitlines()
            if line.startswith("SPOTCHECK ")
        ]
        if not reports:
            raise AssertionError(f"no spot-check report in the harness output:\n{stdout}")
        entries = json.loads(reports[0])

        assert len(entries) == 3, entries
        for entry in entries:
            assert entry["harness"] == entry["manual"], entry
            assert entry["match"] is True, entry
        assert [entry["harness"] for entry in entries] == [True, False, True], entries


def main() -> int:
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
