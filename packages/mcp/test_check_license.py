"""P-360 - the `stitch_check_license` tool tests (the mandated ids).

The CI is bun-only, so the python ids drive the real tool through the bun
harness (packages/mcp/src/tools/__fixtures__/check-license-harness.ts) and
assert on the report it prints. The harness writes real temporary repositories
and runs the real default ports, so the pair verdicts come from the core
licence scan (P-118) and the compatibility matrix (P-120) rather than from a
stub. Only the cache case wraps the scan port, because the P-303
repo-metadata cache is not exported by the core barrel and is recorded as the
deferral in ADR-169.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
HARNESS = REPO_ROOT / "packages/mcp/src/tools/__fixtures__/check-license-harness.ts"

REPO_A_FIELD = "stitch_check_license.repo_a"
REPO_B_FIELD = "stitch_check_license.repo_b"
CACHED_CEILING_MS = 50.0
CATEGORIES = {
    "permissive",
    "weak-copyleft",
    "strong-copyleft",
    "network-copyleft",
    "unknown",
}

_REPORT: dict | None = None


def run_harness() -> dict:
    """Drive the harness and return its report."""
    global _REPORT
    if _REPORT is not None:
        return _REPORT
    proc = subprocess.run(
        ["bun", str(HARNESS)],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise AssertionError(
            f"the harness failed ({proc.returncode}): {proc.stdout}\n{proc.stderr}"
        )
    for line in proc.stdout.splitlines():
        if line.startswith("CHECK_LICENSE "):
            _REPORT = json.loads(line[len("CHECK_LICENSE ") :])
            return _REPORT
    raise AssertionError(
        f"the harness printed no CHECK_LICENSE line: {proc.stdout}\n{proc.stderr}"
    )


def payload(section: str) -> dict:
    """The ok payload of one tool call the harness drove."""
    entry = run_harness()[section]
    assert entry["ok"] is True, entry
    return entry["payload"]


def test_compatible_pair() -> None:
    """Two permissive repositories are compatible and nothing is required."""
    payload_ = payload("compatible")
    assert payload_["verdict"] == "compatible", payload_
    assert payload_["spdx_ids"] == ["Apache-2.0", "MIT"], payload_["spdx_ids"]
    assert payload_["details"]["requirements"] == [], payload_["details"]
    assert payload_["details"]["blockers"] == [], payload_["details"]
    assert payload_["details"]["failing_categories"] == [], payload_["details"]
    assert payload_["details"]["repo_a"]["source"] == "local", payload_["details"]
    assert payload_["details"]["repo_a"]["cached"] is False, payload_["details"]
    assert payload_["details"]["repo_b"]["cached"] is False, payload_["details"]


def test_incompatible_pair() -> None:
    """An undeterminable licence is refused, while copyleft only needs review."""
    payload_ = payload("incompatible")
    assert payload_["verdict"] == "incompatible", payload_
    assert payload_["details"]["blockers"], payload_["details"]
    assert "unknown" in payload_["details"]["failing_categories"], payload_["details"]

    conditional = payload("conditional")
    assert conditional["verdict"] == "conditional", conditional
    assert conditional["details"]["requirements"], conditional["details"]
    assert conditional["details"]["blockers"] == [], conditional["details"]
    assert conditional["details"]["failing_categories"] == [], conditional["details"]


def test_cache_speed() -> None:
    """A cached read is reported as cached and costs far less than the cold one."""
    cache = run_harness()["cache"]
    assert cache["verdict"] == "compatible", cache
    assert cache["cold_flags"] == [False, False], cache
    assert cache["cached_flags"] == [True, True], cache
    assert cache["cached_ms"] < CACHED_CEILING_MS, cache
    assert cache["cached_ms"] <= cache["cold_ms"], cache


def test_spdx_details() -> None:
    """Every licence carries its SPDX id, a name and a known category."""
    compatible = payload("compatible")
    licenses = compatible["details"]["repo_a"]["licenses"]
    assert licenses, compatible["details"]
    for entry in licenses:
        assert entry["spdx_id"], entry
        assert entry["name"], entry
        assert entry["category"] in CATEGORIES, entry
    mit = [entry for entry in licenses if entry["spdx_id"] == "MIT"]
    assert mit and mit[0]["category"] == "permissive", licenses
    assert "MIT" in mit[0]["name"], mit[0]

    gpl_licenses = payload("conditional")["details"]["repo_b"]["licenses"]
    assert {entry["spdx_id"] for entry in gpl_licenses} == {"GPL-3.0-only"}, gpl_licenses
    assert {entry["category"] for entry in gpl_licenses} == {"strong-copyleft"}, gpl_licenses

    errors = run_harness()["errors"]
    assert errors["missing_a"]["field"] == REPO_A_FIELD, errors
    assert errors["missing_b"]["field"] == REPO_B_FIELD, errors


def main() -> int:
    failures = 0
    for name, test in sorted(globals().items()):
        if not name.startswith("test_") or not callable(test):
            continue
        try:
            test()
            print(f"ok {name}")
        except AssertionError as error:
            failures += 1
            print(f"FAIL {name}: {error}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
