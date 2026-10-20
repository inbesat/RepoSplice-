"""P-323 — the `stitch eval run` command test (mandated id).

The command is driven against a corpus whose repos do not exist locally, so
the clone fails fast and OFFLINE: the command must report the failed pair
(exit 1), still write the per-pair result and the summary, and expose its
flags in --help.
"""

import json
import subprocess
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
CLI_ENTRY = REPO_ROOT / "packages" / "cli" / "src" / "index.ts"


def _corpus(directory: Path) -> Path:
    """One pair pointing at a local path that does not exist."""
    path = directory / "pairs.json"
    path.write_text(
        json.dumps(
            [
                {
                    "pair_id": "cli-fixture-1",
                    "repo_a_url": str(directory / "missing-a"),
                    "repo_b_url": str(directory / "missing-b"),
                    "repo_a_sha": "1111111111111111111111111111111111111111",
                    "repo_b_sha": "2222222222222222222222222222222222222222",
                    "extract_paths_a": ["./src"],
                    "extract_paths_b": ["./src"],
                    "ecosystem": "js",
                    "license_a": "MIT",
                    "license_b": "MIT",
                    "expected_outcome": "clean",
                }
            ]
        ),
        encoding="utf-8",
    )
    return path


def test_cli_invocation() -> None:
    """`stitch eval run` exists, runs the corpus and reports the failures."""
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        corpus = _corpus(base)
        out = base / "out"
        done = subprocess.run(
            [
                "bun",
                str(CLI_ENTRY),
                "eval",
                "run",
                "--corpus",
                str(corpus),
                "--output-dir",
                str(out),
            ],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
        )
        assert done.returncode == 1, (
            f"expected exit 1 (the pair fails), got {done.returncode}: {done.stdout}{done.stderr}"
        )
        result_file = out / "cli-fixture-1.json"
        assert result_file.exists(), "the per-pair result file is missing"
        result = json.loads(result_file.read_text(encoding="utf-8"))
        assert result["status"] == "failed"
        assert result["error_code"], "the failure must carry a typed error code"
        summary = json.loads((out / "summary.json").read_text(encoding="utf-8"))
        assert summary["pairs"] == 1
        assert summary["failed"] == 1

    help_run = subprocess.run(
        ["bun", str(CLI_ENTRY), "eval", "run", "--help"],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
    )
    assert help_run.returncode == 0, help_run.stderr
    for flag in ("--corpus", "--parallel", "--output-dir"):
        assert flag in help_run.stdout, f"{flag} is missing from the help output"


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
