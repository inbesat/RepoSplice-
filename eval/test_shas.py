#!/usr/bin/env python3
"""P-322 - the pinned corpus SHAs are verified and drift is detected.

The two tests are hermetic: they drive `verify_shas` with an injected resolver
so the suite never depends on the network.  Set STITCH_EVAL_VERIFY_NETWORK=1
to additionally run the real `git ls-remote` check over every pin.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "eval" / "scripts"))

import verify_shas  # noqa: E402  (path bootstrap above)

MANIFEST = REPO_ROOT / "eval" / "corpus" / "pairs.json"


class FakeResolver:
    """A scripted resolver.

    ``missing_at`` / ``unknown_at`` are CALL INDEXES, so one injected fault
    affects exactly one pin even when the same repo is pinned by two pairs
    (axios appears in both `js-axios-ky` and `js-axios-versions`).
    """

    def __init__(
        self,
        overrides: dict[tuple[str, str], tuple[str, str]] | None = None,
        missing_at: int | None = None,
        unknown_at: int | None = None,
    ) -> None:
        self.overrides = overrides or {}
        self.missing_at = missing_at
        self.unknown_at = unknown_at
        self.calls: list[tuple[str, str]] = []

    def resolves(self, owner_repo: str, sha: str) -> tuple[str, str]:
        index = len(self.calls)
        self.calls.append((owner_repo, sha))
        if self.missing_at is not None and index == self.missing_at:
            return ("missing", "the tag moved")
        if self.unknown_at is not None and index == self.unknown_at:
            return ("unknown", "rate limited")
        return self.overrides.get(
            (owner_repo, sha), ("ok", "reachable as a remote tag tip")
        )


def load_pairs() -> list[dict]:
    return json.loads(MANIFEST.read_text(encoding="utf-8"))


def test_all_shas_verified() -> None:
    """Every pair carries a 40-hex sha on both sides and nothing has drifted."""
    pairs = load_pairs()
    assert len(pairs) == 20, f"expected 20 pairs, found {len(pairs)}"
    for pair in pairs:
        for side in ("a", "b"):
            sha = pair[f"repo_{side}_sha"]
            assert verify_shas.is_sha(sha), f"{pair['pair_id']} {side}: {sha!r} is not a 40-hex sha"
    resolver = FakeResolver()
    results = verify_shas.verify_pairs(pairs, resolver)
    counts = verify_shas.summarize(results)
    assert counts["missing"] == 0, f"drift detected: {results}"
    assert counts["unknown"] == 0, f"unknown pins: {results}"
    assert counts["ok"] == len(pairs) * 2, f"expected {len(pairs) * 2} pins, checked {counts['ok']}"
    assert verify_shas.main([], resolver=resolver) == 0

    if os.environ.get("STITCH_EVAL_VERIFY_NETWORK") == "1":
        network = verify_shas.LsRemoteResolver()
        remote = verify_shas.summarize(verify_shas.verify_pairs(pairs, network))
        assert remote["missing"] == 0, f"upstream drift: {remote}"


def test_drift_detection() -> None:
    """A pin that no longer resolves is reported as drift and exits non-zero."""
    pairs = load_pairs()
    resolver = FakeResolver(missing_at=0)
    results = verify_shas.verify_pairs(pairs, resolver)
    counts = verify_shas.summarize(results)
    assert counts["missing"] == 1, f"expected exactly one drift, got {counts}"
    drifted = [result for result in results if result["state"] == "missing"]
    assert drifted[0]["pair_id"] == pairs[0]["pair_id"]
    assert drifted[0]["side"] == "a"
    assert verify_shas.main([], resolver=FakeResolver(missing_at=0)) == 1

    # an unreachable remote is a gate error, never drift
    unknown = FakeResolver(unknown_at=0)
    unknown_counts = verify_shas.summarize(verify_shas.verify_pairs(pairs, unknown))
    assert unknown_counts["missing"] == 0
    assert unknown_counts["unknown"] == 1
    assert verify_shas.main([], resolver=FakeResolver(unknown_at=0)) == 2


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
