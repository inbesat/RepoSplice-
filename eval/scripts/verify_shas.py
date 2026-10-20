#!/usr/bin/env python3
"""P-322 - verify that every pinned corpus SHA still resolves on its remote.

The corpus (`eval/corpus/pairs.json`) pins both sides of every pair to an exact
40-hex commit, so a re-run of the evaluation (P-323) consumes identical inputs.
This script proves each pin is still reachable upstream.

Exit codes:
  0 - every pinned SHA resolves
  1 - drift: at least one pinned SHA no longer resolves
  2 - gate error (the manifest is unreadable, or a check could not be run)

No authentication is required: the default resolver asks git for the remote's
tag tips (`git ls-remote --tags`), the same unauthenticated transport the
corpus was built with.  `--mode api` uses the unauthenticated GitHub commits
API instead (rate limited to 60 requests per hour).

A rate-limited or unreachable remote is reported as `unknown` and exits 2 -
never as drift, so a network hiccup can not be mistaken for a moved pin.
"""

from __future__ import annotations

import json
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Protocol

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MANIFEST = REPO_ROOT / "eval" / "corpus" / "pairs.json"
SHA_LENGTH = 40
USER_AGENT = "repo-stitcher-eval-verifier"
SIDES = ("a", "b")


class Resolver(Protocol):
    """Resolves one pinned SHA against its remote."""

    def resolves(self, owner_repo: str, sha: str) -> tuple[str, str]:
        """Return ``(state, detail)`` where state is ok | missing | unknown."""


def parse_owner_repo(url: str) -> str:
    """`https://github.com/owner/repo(.git)` -> `owner/repo`."""
    trimmed = url.strip().rstrip("/")
    if trimmed.endswith(".git"):
        trimmed = trimmed[: -len(".git")]
    if "github.com" in trimmed:
        trimmed = trimmed.split("github.com", 1)[1]
    trimmed = trimmed.strip("/")
    parts = [part for part in trimmed.split("/") if part]
    if len(parts) < 2:
        raise ValueError(f"cannot read an owner/repo from {url!r}")
    return f"{parts[0]}/{parts[1]}"


def is_sha(value: object) -> bool:
    """True for a lowercase 40-hex commit id."""
    if not isinstance(value, str) or len(value) != SHA_LENGTH:
        return False
    return all(char in "0123456789abcdef" for char in value)


class LsRemoteResolver:
    """Unauthenticated: ask git for the remote's tag tips."""

    def __init__(self, timeout: int = 30) -> None:
        self.timeout = timeout

    def resolves(self, owner_repo: str, sha: str) -> tuple[str, str]:
        url = f"https://github.com/{owner_repo}.git"
        try:
            completed = subprocess.run(
                ["git", "ls-remote", "--tags", url],
                capture_output=True,
                text=True,
                timeout=self.timeout,
                check=False,
            )
        except subprocess.TimeoutExpired:
            return "unknown", f"git ls-remote timed out after {self.timeout}s"
        except OSError as error:
            return "unknown", f"git ls-remote failed: {error}"
        if completed.returncode != 0:
            detail = (completed.stderr or "").strip().splitlines()
            return "unknown", detail[-1][:200] if detail else "git ls-remote failed"
        tips = {
            line.split()[0]
            for line in completed.stdout.splitlines()
            if line.strip()
        }
        if sha in tips:
            return "ok", "reachable as a remote tag tip"
        return "missing", "not among the remote tag tips"


class ApiResolver:
    """Unauthenticated GitHub commits API (60 requests per hour)."""

    def __init__(self, timeout: int = 30) -> None:
        self.timeout = timeout

    def resolves(self, owner_repo: str, sha: str) -> tuple[str, str]:
        url = f"https://api.github.com/repos/{owner_repo}/commits/{sha}"
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                if response.status == 200:
                    return "ok", "the commit endpoint resolved it"
                return "unknown", f"unexpected status {response.status}"
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return "missing", "the commit endpoint does not know it"
            if error.code in (403, 429):
                return "unknown", f"rate limited (status {error.code})"
            return "unknown", f"unexpected status {error.code}"
        except (urllib.error.URLError, OSError) as error:
            return "unknown", f"request failed: {error}"


def verify_pairs(
    pairs: list[dict], resolver: Resolver
) -> list[dict]:
    """Check both sides of every pair. One result per side."""
    results: list[dict] = []
    for pair in pairs:
        pair_id = str(pair.get("pair_id", "<unnamed>"))
        for side in SIDES:
            url = str(pair.get(f"repo_{side}_url", ""))
            sha = str(pair.get(f"repo_{side}_sha", ""))
            try:
                owner_repo = parse_owner_repo(url)
            except ValueError as error:
                results.append(
                    {
                        "pair_id": pair_id,
                        "side": side,
                        "repo": url,
                        "sha": sha,
                        "state": "unknown",
                        "detail": str(error),
                    }
                )
                continue
            if not is_sha(sha):
                results.append(
                    {
                        "pair_id": pair_id,
                        "side": side,
                        "repo": owner_repo,
                        "sha": sha,
                        "state": "missing",
                        "detail": "not a 40-char lowercase hex sha",
                    }
                )
                continue
            state, detail = resolver.resolves(owner_repo, sha)
            results.append(
                {
                    "pair_id": pair_id,
                    "side": side,
                    "repo": owner_repo,
                    "sha": sha,
                    "state": state,
                    "detail": detail,
                }
            )
    return results


def summarize(results: list[dict]) -> dict[str, int]:
    """Count the outcomes."""
    counts = {"ok": 0, "missing": 0, "unknown": 0}
    for result in results:
        state = str(result["state"])
        counts[state] = counts.get(state, 0) + 1
    return counts


def load_manifest(path: Path) -> list[dict]:
    """Read the corpus manifest. Raises on a bad shape."""
    raw = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(raw, dict):
        raw = raw.get("pairs", [])
    if not isinstance(raw, list):
        raise ValueError("the manifest must hold a list of pairs")
    return [pair for pair in raw if isinstance(pair, dict)]


def main(argv: list[str], resolver: Resolver | None = None) -> int:
    """Run the verification. 0 intact, 1 drift, 2 gate error."""
    manifest = DEFAULT_MANIFEST
    mode = "ls-remote"
    timeout = 30
    index = 0
    while index < len(argv):
        argument = argv[index]
        if argument == "--manifest" and index + 1 < len(argv):
            index += 1
            manifest = Path(argv[index])
        elif argument == "--mode" and index + 1 < len(argv):
            index += 1
            mode = argv[index]
        elif argument == "--timeout" and index + 1 < len(argv):
            index += 1
            try:
                timeout = int(argv[index])
            except ValueError:
                print(f"invalid timeout {argv[index]!r}", file=sys.stderr)
                return 2
        else:
            print(f"unknown argument {argument!r}", file=sys.stderr)
            return 2
        index += 1

    try:
        pairs = load_manifest(manifest)
    except (OSError, ValueError) as error:
        print(f"gate error: cannot read the corpus manifest: {error}", file=sys.stderr)
        return 2
    if len(pairs) == 0:
        print("gate error: the corpus manifest holds no pairs", file=sys.stderr)
        return 2

    if resolver is None:
        if mode == "api":
            resolver = ApiResolver(timeout=timeout)
        elif mode == "ls-remote":
            resolver = LsRemoteResolver(timeout=timeout)
        else:
            print(f"unknown mode {mode!r}", file=sys.stderr)
            return 2

    results = verify_pairs(pairs, resolver)
    counts = summarize(results)
    for result in results:
        print(
            f"{result['state']:>7}  {result['pair_id']} {result['side']}  "
            f"{result['repo']}@{result['sha'][:12]}  {result['detail']}"
        )
    print(
        f"sha verification: {counts['ok']} ok, {counts['missing']} missing, "
        f"{counts['unknown']} unknown ({len(results)} pins checked)"
    )
    if counts["missing"] > 0:
        print("drift: a pinned sha no longer resolves upstream", file=sys.stderr)
        return 1
    if counts["unknown"] > 0:
        print(
            "gate error: some pins could not be checked (network or rate limit)",
            file=sys.stderr,
        )
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
