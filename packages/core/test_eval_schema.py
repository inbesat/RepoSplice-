"""P-320 - the eval corpus schema contract (the mandated pytest ids).

Run it with pytest:

    pytest packages/core/test_eval_schema.py

or standalone, without pytest installed:

    python packages/core/test_eval_schema.py

The python side of the corpus contract is validated by
``eval/scripts/validate_corpus.py`` (standard library only); the bun mirror
lives in ``packages/core/src/__tests__/eval-schema.test.ts`` so the CI (which
is bun-only) enforces the same contract.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "eval" / "scripts"))

import validate_corpus  # noqa: E402  (the path bootstrap above must run first)

SCHEMA_PATH = REPO_ROOT / "eval" / "corpus" / "schema.json"
MANIFEST_PATH = REPO_ROOT / "eval" / "corpus" / "pairs.json"
EXAMPLE_PATH = REPO_ROOT / "eval" / "corpus" / "pair-example" / "pair.json"


def test_schema_valid() -> None:
    """The emitted JSON Schema describes the corpus contract."""
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    assert schema.get("type") == "object", "the corpus schema must be an object"
    properties = schema.get("properties", {})
    for field in (
        "pair_id",
        "repo_a_url",
        "repo_b_url",
        "repo_a_sha",
        "repo_b_sha",
        "extract_paths_a",
        "extract_paths_b",
        "ecosystem",
        "license_a",
        "license_b",
        "expected_outcome",
    ):
        assert field in properties, f"{field} must be part of the schema"
    assert "clean" in properties["expected_outcome"]["enum"]
    assert "js" in properties["ecosystem"]["enum"]
    assert properties["repo_a_sha"]["pattern"] == "^[0-9a-f]{40}$"


def test_example_pair_validates() -> None:
    """The hand-written example pair passes the schema."""
    example = json.loads(EXAMPLE_PATH.read_text(encoding="utf-8"))
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    errors = validate_corpus.validate_instance(schema, example, schema, "$")
    assert errors == [], errors
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    assert any(entry.get("pair_id") == example["pair_id"] for entry in manifest)


def test_invalid_rejected() -> None:
    """A pair with a bad sha and an unknown ecosystem is rejected."""
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    broken = {
        "pair_id": "broken-0001",
        "repo_a_url": "https://github.com/octocat/Hello-World",
        "repo_b_url": "https://github.com/octocat/Spoon-Knife",
        "repo_a_sha": "not-a-sha",
        "repo_b_sha": "0" * 40,
        "extract_paths_a": [],
        "extract_paths_b": [],
        "ecosystem": "cobol",
        "license_a": "MIT",
        "license_b": "MIT",
        "expected_outcome": "clean",
    }
    errors = validate_corpus.validate_instance(schema, broken, schema, "$")
    assert errors, "an invalid pair must be rejected"
    assert any("repo_a_sha" in error for error in errors)
    assert any("ecosystem" in error for error in errors)
    missing = dict(broken)
    del missing["pair_id"]
    missing_errors = validate_corpus.validate_instance(schema, missing, schema, "$")
    assert any("pair_id" in error for error in missing_errors)


if __name__ == "__main__":
    failures = 0
    for name, test in sorted(globals().items()):
        if name.startswith("test_") and callable(test):
            try:
                test()
                print(f"ok {name}")
            except AssertionError as error:
                failures += 1
                print(f"FAIL {name}: {error}")
    raise SystemExit(1 if failures else 0)
