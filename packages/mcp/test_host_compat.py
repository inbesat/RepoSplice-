"""The mandated P-363 ids.

They assert BOTH halves of the host compatibility pass:

1. the machine-checked protocol profile for each host shape, measured by
   `packages/mcp/test/host-compat.ts` on every run; and
2. the honest per-host record in `MCP_COMPAT.md`, which must say `not run` — a
   fabricated pass cannot satisfy these ids because no MCP host is installable
   here (ADR-172).
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
HARNESS = REPO_ROOT / "packages" / "mcp" / "test" / "host-compat.ts"
COMPAT_DOC = REPO_ROOT / "MCP_COMPAT.md"

PROTOCOL_VERSION = "2024-11-05"
SERVER_NAME = "repo-stitcher"
TOOL_COUNT = 10
PROGRESS_TOKEN = "tok-host-compat"
TOOL_NAMES = (
    "merge_manifests",
    "run_pipeline",
    "run_sandbox_build",
    "scan_licenses",
    "stitch_cancel_job",
    "stitch_check_license",
    "stitch_job_status",
    "stitch_merge",
    "stitch_select_files",
    "subscribe_job_events",
)

_REPORT = None
_RAW = ""


def run_harness():
    """Run the conformance harness once and cache its one-line report."""
    global _REPORT, _RAW
    if _REPORT is None:
        completed = subprocess.run(
            ["bun", str(HARNESS)],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
        )
        _RAW = completed.stdout
        assert completed.returncode == 0, (
            f"the harness exited {completed.returncode}: {completed.stderr[-2000:]}"
        )
        line = next(
            (item for item in completed.stdout.splitlines() if item.startswith("HOST_COMPAT ")),
            None,
        )
        assert line is not None, (
            f"the harness printed no HOST_COMPAT line:\n{completed.stdout[-2000:]}"
        )
        _REPORT = json.loads(line[len("HOST_COMPAT ") :])
    return _REPORT


def compat_doc():
    """The compatibility document, which must exist and record the deferral."""
    assert COMPAT_DOC.exists(), f"MCP_COMPAT.md is missing at {COMPAT_DOC}"
    return COMPAT_DOC.read_text(encoding="utf-8")


def assert_documented(doc, host, command_fragment):
    assert host in doc, f"{host} is not documented in MCP_COMPAT.md"
    assert command_fragment in doc, f"the {host} install command is missing from MCP_COMPAT.md"
    assert "not run" in doc, "MCP_COMPAT.md must record the manual pass as not run"


def test_claude_code():
    report = run_harness()
    server = report["server"]
    assert server["protocol_version"] == PROTOCOL_VERSION, server
    assert server["server_name"] == SERVER_NAME, server
    assert sorted(server["tool_names"]) == sorted(TOOL_NAMES), server

    stdio = report["stdio"]
    assert stdio["initialize_ok"] is True, stdio
    assert stdio["negotiated_version"] == PROTOCOL_VERSION, stdio
    assert stdio["capabilities_tools"] is True, stdio
    assert stdio["tools_list_count"] == TOOL_COUNT, stdio
    assert stdio["every_tool_described"] is True, stdio
    assert stdio["schema_object"] is True, stdio
    assert stdio["schema_additional_properties_false"] is True, stdio
    assert stdio["call_ok"] is True, stdio
    assert stdio["call_tree_paths"] == ["src/index.ts"], stdio
    assert stdio["split_frame_answered"] is True, stdio

    profile = report["hosts"]["claude-code"]
    assert profile["transport"] == "stdio", profile
    assert profile["manual"] is False, profile
    assert profile["initialize_ok"] is True, profile
    assert profile["negotiated_version"] == PROTOCOL_VERSION, profile
    assert profile["tools_list_count"] == TOOL_COUNT, profile
    assert profile["schema_strict"] is True, profile
    assert profile["call_ok"] is True, profile
    assert profile["progress_frames"] == 2, profile
    assert profile["progress_progresses"] == [1, 3], profile

    manual = report["manual"]
    assert manual["claude_code"] == "not run", manual
    assert manual["reason"], manual
    doc = compat_doc()
    assert_documented(doc, "Claude Code", "claude mcp add repo-stitcher")


def test_opencode():
    report = run_harness()

    http = report["http"]
    assert http["health_ok"] is True, http
    assert http["health_status"] == "ok", http
    assert http["post_ok"] is True, http
    assert http["post_status_code"] == 200, http
    assert http["post_tool_count"] == TOOL_COUNT, http
    assert http["notification_status_code"] == 202, http
    assert http["default_port"] == 3435, http
    assert http["error"] is None, http

    profile = report["hosts"]["opencode"]
    assert profile["transport"] == "http", profile
    assert profile["manual"] is False, profile
    assert profile["http_health_ok"] is True, profile
    assert profile["http_post_ok"] is True, profile
    assert profile["notification_status_code"] == 202, profile
    assert profile["call_without_arguments_is_error"] is True, profile
    assert profile["call_tree_paths"] == ["src/index.ts"], profile

    manual = report["manual"]
    assert manual["opencode"] == "not run", manual
    doc = compat_doc()
    assert_documented(doc, "OpenCode", "opencode mcp add repo-stitcher")


def test_cursor():
    report = run_harness()

    stdio = report["stdio"]
    assert stdio["unknown_tool_is_error"] is True, stdio
    assert stdio["call_without_arguments_is_error"] is True, stdio
    assert stdio["unknown_method_code"] == -32601, stdio
    assert stdio["bad_json_code"] == -32700, stdio
    assert stdio["bad_json_id_null"] is True, stdio
    assert stdio["notification_silent"] is True, stdio
    assert stdio["progress_releases"] == 1, stdio
    assert stdio["progress_tokens"] == [PROGRESS_TOKEN, PROGRESS_TOKEN], stdio

    profile = report["hosts"]["cursor"]
    assert profile["transport"] == "stdio", profile
    assert profile["manual"] is False, profile
    assert profile["older_version_answered"] is True, profile
    assert profile["string_id_echoed"] is True, profile
    assert profile["unknown_method_code"] == -32601, profile
    assert profile["bad_json_code"] == -32700, profile
    assert profile["bad_json_id_null"] is True, profile
    assert profile["notification_silent"] is True, profile
    assert profile["split_frame_answered"] is True, profile

    manual = report["manual"]
    assert manual["cursor"] == "not run", manual
    doc = compat_doc()
    assert_documented(doc, "Cursor", "packages/mcp/src/index.ts")


def main():
    failed = 0
    for name, function in sorted(globals().items()):
        if not name.startswith("test_") or not callable(function):
            continue
        try:
            function()
        except Exception as error:  # noqa: BLE001 - the driver reports every failure
            print(f"FAIL {name}: {error}")
            failed += 1
        else:
            print(f"ok {name}")
    return 1 if failed else 0


raise SystemExit(main())
