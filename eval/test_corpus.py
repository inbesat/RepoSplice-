"""P-321 — corpus checks for the 20 sourced repo pairs.

Mandated test ids (plan): test_pair_count, test_per_ecosystem_balance,
test_sha_pinned, test_license_compliant. The file runs under pytest AND
standalone (``python eval/test_corpus.py``) so it can be verified without
pytest installed.

The permissive SPDX set below mirrors
``packages/core/src/license/categories.ts`` (the repo's single source of
truth). The python side cannot import the TypeScript module, so the set is
repeated here and the vitest mirror
(``packages/core/src/__tests__/eval-schema.test.ts``) asserts the same rule
against the real table.
"""

from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
PAIRS_PATH = REPO_ROOT / "eval" / "corpus" / "pairs.json"
SCHEMA_PATH = REPO_ROOT / "eval" / "corpus" / "schema.json"

SHA40 = re.compile(r"^[0-9a-f]{40}$")

# Keep in sync with packages/core/src/license/categories.ts.
PERMISSIVE = {
    "MIT",
    "Apache-2.0",
    "BSD-2-Clause",
    "BSD-3-Clause",
    "ISC",
    "0BSD",
    "BlueOak-1.0.0",
    "Unlicense",
    "CC0-1.0",
    "WTFPL",
    "Zlib",
}

EXPECTED_PAIRS = 20
ECOSYSTEMS = ("js", "python", "go", "rust")


def load_pairs() -> list[dict]:
    """The corpus manifest as a list of pair dicts."""
    with PAIRS_PATH.open(encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, list):
        raise AssertionError(f"{PAIRS_PATH} must hold a JSON array")
    return data


def test_pair_count() -> None:
    """The corpus holds exactly 20 sourced pairs."""
    pairs = load_pairs()
    assert len(pairs) == EXPECTED_PAIRS, f"expected {EXPECTED_PAIRS} pairs, got {len(pairs)}"


def test_per_ecosystem_balance() -> None:
    """Each ecosystem (js, python, go, rust) holds 5 pairs."""
    counts = Counter(pair["ecosystem"] for pair in load_pairs())
    for ecosystem in ECOSYSTEMS:
        assert counts[ecosystem] == 5, f"{ecosystem} has {counts[ecosystem]} pairs, expected 5"


def test_sha_pinned() -> None:
    """Every side is pinned to a full 40-character commit SHA."""
    for pair in load_pairs():
        for side in ("repo_a_sha", "repo_b_sha"):
            sha = pair[side]
            assert SHA40.match(sha), f"{pair['pair_id']}.{side} is not a 40-hex SHA: {sha}"


def test_license_compliant() -> None:
    """Every repo carries a permissive license (P-127 policy)."""
    for pair in load_pairs():
        for side in ("license_a", "license_b"):
            license_id = pair[side]
            assert license_id in PERMISSIVE, (
                f"{pair['pair_id']}.{side} is not permissive: {license_id}"
            )


def test_manifest_validates_against_the_schema() -> None:
    """The manifest validates against the emitted JSON Schema (P-320)."""
    sys.path.insert(0, str(REPO_ROOT / "eval" / "scripts"))
    import validate_corpus  # noqa: E402  (path bootstrap must run first)

    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    for index, pair in enumerate(load_pairs()):
        errors = validate_corpus.validate_instance(schema, pair, schema, f"$[{index}]")
        assert errors == [], f"pair {index} is invalid: {errors}"


def main() -> int:
    """Run every test_* in this module; return a process exit code."""
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
    if failures:
        print(f"{failures} test(s) failed")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
