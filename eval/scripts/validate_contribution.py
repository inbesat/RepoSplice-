#!/usr/bin/env python3
"""P-332 - validate a proposed corpus contribution (a new repo pair).

The corpus is a benchmark: a pair that adds nothing but another instance of
what is already there dilutes the signal. So a contribution is checked on
four axes, and every failure is reported as a message, never as a crash:

  1. schema      - the P-320 pair schema (eval/corpus/schema.json).
  2. license     - both sides must carry a PERMISSIVE license (P-127).
  3. pinning     - both sides must carry a real 40 hex commit SHA.
  4. diversity   - a NEW pair must add coverage the corpus does not have:
                   a new ecosystem, a new expected outcome, or a failure
                   mode from the P-331 taxonomy that no pair uses yet.

The network check (is the pinned commit still reachable?) is OPT-IN via
STITCH_EVAL_VERIFY_NETWORK=1 - the same hermetic-by-default rule the P-322
SHA verifier uses. A timeout or a rate limit becomes an error message; it
never becomes a traceback.
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from validate_corpus import load_json, validate_instance  # noqa: E402
from verify_shas import LsRemoteResolver, parse_owner_repo  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SCHEMA = REPO_ROOT / "eval" / "corpus" / "schema.json"
DEFAULT_CORPUS = REPO_ROOT / "eval" / "corpus" / "pairs.json"
NETWORK_ENV = "STITCH_EVAL_VERIFY_NETWORK"

# The permissive set. packages/core/src/license/categories.ts is the source
# of truth; this mirror exists because the python tooling cannot import it.
PERMISSIVE_LICENSES = frozenset(
    {
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
)

# The failure modes a pair may declare (the P-331 taxonomy).
TAXONOMY_CATEGORIES = (
    "import-resolution",
    "semver-conflict",
    "license-block",
    "loop-cap-exceeded",
    "sandbox-timeout",
    "semantic-wrong-but-builds",
)

SHA40 = re.compile(r"^[0-9a-f]{40}$")


def _corpus_facts(corpus: list[dict]) -> tuple[set[str], set[str], set[str], set[str]]:
    """The ids, ecosystems, outcomes and failure modes the corpus already has."""
    ids: set[str] = set()
    ecosystems: set[str] = set()
    outcomes: set[str] = set()
    failure_modes: set[str] = set()
    for entry in corpus:
        if not isinstance(entry, dict):
            continue
        pair_id = entry.get("pair_id")
        if isinstance(pair_id, str):
            ids.add(pair_id)
        ecosystem = entry.get("ecosystem")
        if isinstance(ecosystem, str):
            ecosystems.add(ecosystem)
        outcome = entry.get("expected_outcome")
        if isinstance(outcome, str):
            outcomes.add(outcome)
        failure_mode = entry.get("failure_mode")
        if isinstance(failure_mode, str):
            failure_modes.add(failure_mode)
    return ids, ecosystems, outcomes, failure_modes


def _license_errors(candidate: dict) -> list[str]:
    errors: list[str] = []
    for side in ("a", "b"):
        license_id = candidate.get(f"license_{side}")
        if not isinstance(license_id, str) or license_id not in PERMISSIVE_LICENSES:
            errors.append(
                f"license_{side}: {license_id!r} is not a permissive license "
                f"(allowed: {', '.join(sorted(PERMISSIVE_LICENSES))})"
            )
    return errors


def _sha_errors(candidate: dict) -> list[str]:
    errors: list[str] = []
    for side in ("a", "b"):
        sha = candidate.get(f"repo_{side}_sha")
        if not isinstance(sha, str) or SHA40.match(sha) is None:
            errors.append(f"repo_{side}_sha: {sha!r} is not a 40 char lowercase hex commit")
    return errors


def _diversity_errors(candidate: dict, corpus: list[dict]) -> list[str]:
    """A NEW pair must add coverage the corpus does not have yet."""
    ids, ecosystems, outcomes, failure_modes = _corpus_facts(corpus)
    pair_id = candidate.get("pair_id")
    if isinstance(pair_id, str) and pair_id in ids:
        # The pair is already in the corpus - nothing new to prove.
        return []
    errors: list[str] = []
    ecosystem = candidate.get("ecosystem")
    outcome = candidate.get("expected_outcome")
    failure_mode = candidate.get("failure_mode")
    new_ecosystem = isinstance(ecosystem, str) and ecosystem not in ecosystems
    new_outcome = isinstance(outcome, str) and outcome not in outcomes
    new_failure_mode = (
        isinstance(failure_mode, str)
        and failure_mode in TAXONOMY_CATEGORIES
        and failure_mode not in failure_modes
    )
    if not (new_ecosystem or new_outcome or new_failure_mode):
        errors.append(
            f"pair_id: {pair_id!r} adds no new coverage - a new pair must add a new "
            f"ecosystem, a new expected outcome, or a failure_mode from "
            f"{', '.join(TAXONOMY_CATEGORIES)} that the corpus does not use yet"
        )
    if isinstance(failure_mode, str) and failure_mode not in TAXONOMY_CATEGORIES:
        errors.append(
            f"failure_mode: {failure_mode!r} is not one of "
            f"{', '.join(TAXONOMY_CATEGORIES)}"
        )
    return errors


def _network_errors(candidate: dict) -> list[str]:
    """Is the pinned commit still reachable? (opt-in, never raises)"""
    errors: list[str] = []
    resolver = LsRemoteResolver()
    for side in ("a", "b"):
        url = candidate.get(f"repo_{side}_url")
        sha = candidate.get(f"repo_{side}_sha")
        if not isinstance(url, str) or not isinstance(sha, str):
            continue
        owner_repo = parse_owner_repo(url)
        if owner_repo == "":
            errors.append(f"repo_{side}_url: {url!r} is not a GitHub repository url")
            continue
        state, detail = resolver.resolves(owner_repo, sha)
        if state != "ok":
            errors.append(
                f"repo_{side}_sha: {sha} is not reachable in {owner_repo} ({state}: {detail})"
            )
    return errors


def validate_candidate(
    candidate: dict,
    corpus: list[dict],
    *,
    check_network: bool = False,
    schema: dict | None = None,
) -> list[str]:
    """Every problem with one proposed pair, as messages (empty = it passes)."""
    if not isinstance(candidate, dict):
        return ["candidate: the entry must be a JSON object"]
    errors: list[str] = []
    document = schema if schema is not None else load_json(DEFAULT_SCHEMA)
    errors.extend(validate_instance(document, candidate, document))
    errors.extend(_license_errors(candidate))
    errors.extend(_sha_errors(candidate))
    errors.extend(_diversity_errors(candidate, corpus))
    if check_network:
        errors.extend(_network_errors(candidate))
    return errors


def _read_json(path: Path) -> object:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def main(argv: list[str]) -> int:
    """CLI: validate one candidate (or a list of them) against the corpus."""
    candidate_path: Path | None = None
    corpus_path = DEFAULT_CORPUS
    schema_path = DEFAULT_SCHEMA
    check_network = os.environ.get(NETWORK_ENV) == "1"

    index = 0
    while index < len(argv):
        argument = argv[index]
        if argument == "--candidate" and index + 1 < len(argv):
            candidate_path = Path(argv[index + 1])
            index += 2
            continue
        if argument == "--corpus" and index + 1 < len(argv):
            corpus_path = Path(argv[index + 1])
            index += 2
            continue
        if argument == "--schema" and index + 1 < len(argv):
            schema_path = Path(argv[index + 1])
            index += 2
            continue
        if argument == "--network":
            check_network = True
            index += 1
            continue
        sys.stderr.write(f"unknown argument: {argument}\n")
        return 2

    if candidate_path is None:
        sys.stderr.write("--candidate <path> is required\n")
        return 2
    if not candidate_path.exists():
        sys.stderr.write(f"no candidate at {candidate_path}\n")
        return 2

    try:
        candidate_doc = _read_json(candidate_path)
        corpus_doc = _read_json(corpus_path)
        schema_doc = _read_json(schema_path)
    except (OSError, ValueError) as error:
        sys.stderr.write(f"cannot read the inputs: {error}\n")
        return 2

    candidates = candidate_doc if isinstance(candidate_doc, list) else [candidate_doc]
    corpus = corpus_doc if isinstance(corpus_doc, list) else []
    if not isinstance(schema_doc, dict):
        sys.stderr.write("the schema must be a JSON object\n")
        return 2

    failures = 0
    for candidate in candidates:
        errors = validate_candidate(
            candidate, corpus, check_network=check_network, schema=schema_doc
        )
        if not errors:
            continue
        failures += 1
        pair_id = candidate.get("pair_id") if isinstance(candidate, dict) else "?"
        sys.stdout.write(f"{pair_id}: {len(errors)} problem(s)\n")
        for error in errors:
            sys.stdout.write(f"  - {error}\n")

    if failures > 0:
        sys.stdout.write(f"{failures} contribution(s) rejected\n")
        return 1
    sys.stdout.write("ok: the contribution passes\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
