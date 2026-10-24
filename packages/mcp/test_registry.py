"""P-364 mandated ids: the MCP registry entry, and the publish path.

Standalone driver (not pytest), mirroring the other `test_*.py` files in this
package: it runs the bun harness, which builds the entry through the REAL ports
and reports what it measured, and asserts on the report.

    uv run --no-project python packages/mcp/test_registry.py
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
HARNESS = REPO_ROOT / "packages" / "mcp" / "src" / "__fixtures__" / "registry-harness.ts"
ENTRY_FILE = REPO_ROOT / "MCP_REGISTRY_ENTRY.json"

ENTRY_NAME = "repo-stitcher"
ENTRY_VERSION = "0.0.0"
TOOL_COUNT = 10
PRIMARY_TOOLS = (
    "stitch_select_files",
    "stitch_merge",
    "stitch_job_status",
    "stitch_check_license",
)
VALIDATED = ["name", "version", "description", "tools", "installation"]
BLOCKER_FRAGMENTS = (
    "the package is private",
    "the package license is UNLICENSED",
    "the repository has no LICENSE file",
    "MCP_REGISTRY_URL is not set",
    "MCP_REGISTRY_TOKEN is not set",
)

_REPORT: dict | None = None


def run_harness() -> dict:
    """Run the harness once and cache the parsed report."""
    global _REPORT
    if _REPORT is not None:
        return _REPORT
    completed = subprocess.run(
        ["bun", str(HARNESS)],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )
    assert completed.returncode == 0, (
        f"the registry harness exited {completed.returncode}:\n"
        f"{completed.stdout}\n{completed.stderr}"
    )
    for line in completed.stdout.splitlines():
        if line.startswith("REGISTRY "):
            _REPORT = json.loads(line[len("REGISTRY ") :])
            return _REPORT
    raise AssertionError(f"the harness printed no REGISTRY line:\n{completed.stdout}")


def test_entry_discoverable() -> None:
    """The entry a registry would index: identity, tools, install, and honesty."""
    report = run_harness()
    entry = report["entry"]

    assert entry["ok"] is True, entry
    assert entry["name"] == ENTRY_NAME, entry
    assert entry["version"] == ENTRY_VERSION, entry
    assert entry["description_length"] >= 20, entry
    assert entry["repository"].startswith("https://"), entry
    assert "RepoSplice" in entry["repository"], entry
    assert entry["homepage"] == f"{entry['repository']}#readme", entry
    assert entry["tool_count"] == TOOL_COUNT, entry
    assert entry["primary_present"] is True, entry
    for tool in PRIMARY_TOOLS:
        assert tool in entry["tools"], (tool, entry)

    installation = entry["installation"]
    assert ENTRY_NAME in installation["stdio"], installation
    assert installation["stdio"].endswith("mcp server"), installation
    assert installation["http"].endswith("mcp server --http"), installation

    # The entry is generated, not published: a fabricated status is the failure
    # this id exists to catch (ADR-173).
    assert entry["status"] == "not submitted", entry

    validated = report["validate"]
    assert validated["ok"] == {"ok": True, "value": VALIDATED}, validated
    assert validated["name"]["field"] == "registry.name", validated
    assert validated["version"]["field"] == "registry.version", validated
    assert validated["description"]["field"] == "registry.description", validated
    assert validated["tools"]["field"] == "registry.tools", validated
    assert validated["install"]["field"] == "registry.install", validated
    for key in ("name", "version", "description", "tools", "install"):
        assert validated[key]["ok"] is False, (key, validated)
        assert validated[key]["code"] == "CONFIG_ERROR", (key, validated)

    artifact = report["artifact"]
    assert artifact["exists"] is True, artifact
    assert artifact["name"] == ENTRY_NAME, artifact
    assert artifact["tools_count"] == TOOL_COUNT, artifact
    assert artifact["in_sync"] is True, artifact
    assert ENTRY_FILE.exists(), f"{ENTRY_FILE} is not committed"
    committed = json.loads(ENTRY_FILE.read_text(encoding="utf-8"))
    assert committed["name"] == ENTRY_NAME, committed
    assert committed["status"] == "not submitted", committed
    assert len(committed["tools"]) == TOOL_COUNT, committed

    drift = report["drift"]
    assert drift["in_sync"] is True, drift
    assert drift["stale"]["ok"] is False, drift
    assert drift["stale"]["field"] == "registry.file", drift

    package = report["blockers"]["package"]
    assert package == {"private": True, "license": "UNLICENSED", "has_license_file": False}, package


def test_auto_publish() -> None:
    """The publish path refuses honestly, and the release job is wired."""
    report = run_harness()

    ci = report["ci"]
    assert ci["registry_job"] is True, ci
    assert ci["has_token_secret"] is True, ci
    assert ci["has_url_var"] is True, ci
    assert ci["guarded_skip"] is True, ci
    assert ci["on_tag"] is True, ci
    assert ci["filename"] == "MCP_REGISTRY_ENTRY.json", ci

    blockers = report["blockers"]
    assert len(blockers["none"]) == len(BLOCKER_FRAGMENTS), blockers
    for fragment in BLOCKER_FRAGMENTS:
        assert any(fragment in reason for reason in blockers["none"]), (
            fragment,
            blockers["none"],
        )
    configured = blockers["with_credentials"]
    assert len(configured) == 3, configured
    assert all("not set" not in reason for reason in configured), configured

    publish = report["publish"]
    refused = publish["refused"]
    assert refused["ok"] is False, refused
    assert refused["code"] == "CONFIG_ERROR", refused
    assert refused["field"] == "registry.submission", refused
    assert "cannot proceed" in refused["message"], refused

    accepted = publish["accepted"]
    assert accepted["ok"] is True, accepted
    assert accepted["value"]["submitted"] is True, accepted
    assert accepted["value"]["status"] == 201, accepted
    assert accepted["value"]["url"].startswith("https://"), accepted

    server_error = publish["server_error"]
    assert server_error["ok"] is False, server_error
    assert server_error["field"] == "registry.submission", server_error

    unreachable = publish["unreachable"]
    assert unreachable["ok"] is False, unreachable
    assert unreachable["field"] == "registry.submission", unreachable


def main() -> int:
    failures = 0
    for name, value in sorted(globals().items()):
        if not name.startswith("test_") or not callable(value):
            continue
        try:
            value()
            print(f"ok {name}")
        except AssertionError as error:
            failures += 1
            print(f"FAIL {name}: {error}")
    return 1 if failures else 0


raise SystemExit(main())
