#!/usr/bin/env python3
"""P-332 - the corpus expansion tests.

Three things must hold for a contribution:

  * a valid, diverse pair PASSES (and the CLI says so),
  * an invalid pair is REJECTED with a message that names the problem,
  * a pair that adds no new coverage is REJECTED by the diversity check.

The tests are hermetic: the network check is off (the P-322 precedent), so
nothing here touches the network.
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "eval" / "scripts"))

from validate_contribution import validate_candidate  # noqa: E402

VALIDATOR = REPO_ROOT / "eval" / "scripts" / "validate_contribution.py"

# The corpus as it looks today: one js pair.
CORPUS: list[dict] = [
    {
        "pair_id": "js-axios-ky",
        "repo_a_url": "https://github.com/axios/axios",
        "repo_b_url": "https://github.com/sindresorhus/ky",
        "repo_a_sha": "0" * 40,
        "repo_b_sha": "1" * 40,
        "extract_paths_a": ["./"],
        "extract_paths_b": ["./"],
        "ecosystem": "js",
        "license_a": "MIT",
        "license_b": "MIT",
        "expected_outcome": "clean",
        "failure_mode": "import-resolution",
    }
]


def candidate(overrides: dict) -> dict:
    """A candidate that is valid and diverse unless a test says otherwise."""
    entry = {
        "pair_id": "js-new-pair",
        "repo_a_url": "https://github.com/example/one",
        "repo_b_url": "https://github.com/example/two",
        "repo_a_sha": "a" * 40,
        "repo_b_sha": "b" * 40,
        "extract_paths_a": ["./"],
        "extract_paths_b": ["./"],
        "ecosystem": "js",
        "license_a": "MIT",
        "license_b": "Apache-2.0",
        "expected_outcome": "conflicts",
        "failure_mode": "semver-conflict",
    }
    entry.update(overrides)
    return entry


def run_validator(entry: dict) -> int:
    """Run the validator as a subprocess; return its exit code."""
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        candidate_path = root / "candidate.json"
        corpus_path = root / "pairs.json"
        candidate_path.write_text(json.dumps(entry), encoding="utf-8")
        corpus_path.write_text(json.dumps(CORPUS), encoding="utf-8")
        completed = subprocess.run(
            [
                sys.executable,
                str(VALIDATOR),
                "--candidate",
                str(candidate_path),
                "--corpus",
                str(corpus_path),
            ],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
        )
        return completed.returncode


def test_valid_contribution_passes() -> None:
    errors = validate_candidate(candidate({}), CORPUS)
    assert errors == [], f"a valid contribution must pass, got: {errors}"
    assert run_validator(candidate({})) == 0


def test_invalid_rejected() -> None:
    broken = candidate({"license_a": "AGPL-3.0", "repo_a_sha": "NOTHEX"})
    del broken["extract_paths_b"]
    errors = validate_candidate(broken, CORPUS)
    assert any("license_a" in error for error in errors), errors
    assert any("repo_a_sha" in error for error in errors), errors
    assert any("extract_paths_b" in error for error in errors), errors
    assert run_validator(broken) == 1


def test_diversity_check() -> None:
    redundant = candidate(
        {"expected_outcome": "clean", "failure_mode": "import-resolution"}
    )
    errors = validate_candidate(redundant, CORPUS)
    assert any("adds no new coverage" in error for error in errors), errors
    # a pair already in the corpus is exempt from the diversity rule
    assert validate_candidate(CORPUS[0], CORPUS) == []


def main() -> int:
    failures = 0
    for name, test in sorted(globals().items()):
        if not name.startswith("test_") or not callable(test):
            continue
        try:
            test()
        except AssertionError as error:
            failures += 1
            sys.stdout.write(f"FAIL {name}: {error}\n")
        else:
            sys.stdout.write(f"ok {name}\n")
    return 1 if failures > 0 else 0


if __name__ == "__main__":
    raise SystemExit(main())
