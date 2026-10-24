#!/usr/bin/env python3
"""The mandated P-366 checks for opt-in telemetry (`mcp/test_telemetry.py`).

Telemetry is the one feature whose failure mode is invisible: an opt-in switch
that leaks, an event that quietly carries a repository URL, a log that is
written before anyone consented. These checks drive the real client over the
real ports through `packages/mcp/src/__fixtures__/telemetry-harness.ts` and
assert the four properties the phase names:

* `test_opt_in_required` - nothing is buffered, sent or written until the
  shared store says `telemetry.enabled: true`;
* `test_anonymized` - an event is rebuilt from a fixed whitelist, so a payload
  carrying extra fields (a repository URL, a path, a key) loses them;
* `test_local_logging` - the default sink is the append-only local file, and a
  configured endpoint replaces it rather than adding a second one;
* `test_privacy_no_secrets` - no secret from the store reaches the log or the
  harness output.

Run it with `uv run --no-project python packages/mcp/test_telemetry.py` (the
bare `python` on this machine is a Windows Store stub).
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
HARNESS = REPO_ROOT / "packages" / "mcp" / "src" / "__fixtures__" / "telemetry-harness.ts"
LOG_NAME = "telemetry.log"
ENDPOINT = "https://telemetry.example.invalid/v1/events"
SECRETS = (
    "ghp_telemetry_secret_value",
    "sk-ant-telemetry-secret",
    "https://github.com/secret-org/secret-repo.git",
    "/home/secret-user/private-plans",
)
WHITELIST = (
    "duration_ms,event,success,tool",
    "event,host",
    "duration_s,event,tools_used",
)
EXPECTED_EVENTS = (
    {"event": "session_start", "host": "claude-code"},
    {"event": "tool_called", "tool": "stitch_select_files", "duration_ms": 12, "success": True},
    {"event": "tool_called", "tool": "stitch_merge", "duration_ms": 3, "success": False},
    {"event": "session_end", "duration_s": 42, "tools_used": ["stitch_merge", "stitch_select_files"]},
)

_REPORT: dict[str, object] | None = None
_RAW = ""


def run_harness() -> dict:
    """Run the bun harness once and return the report it printed."""
    global _REPORT, _RAW
    if _REPORT is not None:
        return _REPORT
    completed = subprocess.run(
        ["bun", str(HARNESS)], cwd=REPO_ROOT, capture_output=True, text=True
    )
    assert completed.returncode == 0, f"the harness failed ({completed.returncode}): {completed.stderr}"
    _RAW = completed.stdout
    line = next(
        (entry for entry in completed.stdout.splitlines() if entry.startswith("TELEMETRY ")),
        None,
    )
    assert line is not None, f"the harness printed no TELEMETRY line: {completed.stdout[-500:]}"
    _REPORT = json.loads(line[len("TELEMETRY ") :])
    return _REPORT


def section(name: str) -> dict:
    report = run_harness()
    value = report[name]
    assert isinstance(value, dict), f"the {name} section is not an object: {value!r}"
    return value


def test_opt_in_required() -> None:
    """Off by default: an absent or explicitly disabled flag does nothing."""
    disabled = section("disabled")
    assert disabled["loaded"] is True, disabled
    assert disabled["enabled"] is False, disabled
    assert disabled["absent_loaded"] is True, disabled
    assert disabled["absent_enabled"] is False, disabled
    assert [entry["ok"] for entry in disabled["records"]] == [True, True, True], disabled
    assert disabled["pending"] == 0, disabled
    assert disabled["buffered"] == 0, disabled
    assert disabled["flush"] == {"ok": True, "value": 0}, disabled
    assert disabled["file_written"] is False, disabled
    assert disabled["notice_has_opt_in"] is True, disabled
    assert disabled["notice_names_config"] is True, disabled
    assert disabled["notice_names_log"] is True, disabled
    assert disabled["notice_has_secret"] is False, disabled


def test_local_logging() -> None:
    """The log is written only when enabled, and flushes what was recorded."""
    enabled = section("enabled")
    assert enabled["enabled"] is True, enabled
    assert enabled["path_endswith"] is True, enabled
    assert enabled["file_written"] is True, enabled
    assert enabled["pending_before"] == 4, enabled
    assert enabled["flushed"] == {"ok": True, "value": 4}, enabled
    assert enabled["pending_after"] == 0, enabled
    assert enabled["line_count"] == 4, enabled
    assert enabled["events"] == list(EXPECTED_EVENTS), enabled
    assert enabled["keys_by_event"] == [
        "event,host",
        "duration_ms,event,success,tool",
        "duration_ms,event,success,tool",
        "duration_s,event,tools_used",
    ], enabled
    summary = enabled["summary"]
    assert summary["total"] == 4, summary
    assert summary["by_host"] == {"claude-code": 1}, summary
    assert summary["by_tool"] == {"stitch_select_files": 1, "stitch_merge": 1}, summary
    assert summary["tools_used"] == ["stitch_merge", "stitch_select_files"], summary
    assert "CLI" in summary["comparison"] and "cannot be computed" in summary["comparison"], summary
    assert str(enabled["log_summary"]).startswith("telemetry on"), enabled

    endpoint = section("endpoint")
    assert endpoint["flushed"] == {"ok": True, "value": 1}, endpoint
    assert endpoint["posted_count"] == 1, endpoint
    assert endpoint["posted_endpoint"] == ENDPOINT, endpoint
    assert endpoint["body_lines"] == 1, endpoint
    assert endpoint["file_written"] is False, endpoint
    assert endpoint["pending_after"] == 0, endpoint
    rejected = endpoint["rejected_flush"]
    assert rejected["ok"] is False, endpoint
    assert rejected["code"] == "CONFIG_ERROR", endpoint
    assert rejected["field"] == "telemetry.endpoint", endpoint
    assert endpoint["rejected_pending"] == 1, endpoint
    assert endpoint["rejected_keys"] == ["event,host"], endpoint

    failure = section("failure")
    assert failure["flush"]["ok"] is False, failure
    assert failure["flush"]["code"] == "INTERNAL", failure
    assert failure["pending_after"] == 1, failure
    assert failure["malformed"]["ok"] is False, failure
    assert failure["malformed"]["code"] == "CONFIG_ERROR", failure
    assert failure["malformed"]["field"] == "config", failure

    parse = section("parse")
    assert parse["empty"]["enabled"] is False, parse
    assert parse["enabled"]["enabled"] is True, parse
    assert parse["enabled"]["endpoint"] == ENDPOINT, parse
    assert parse["truthy_string"]["enabled"] is False, parse
    assert parse["not_an_object"]["enabled"] is False, parse
    assert parse["blank_endpoint"]["enabled"] is True, parse


def test_anonymized() -> None:
    """Every event is rebuilt from the whitelist; extra fields are dropped."""
    anonymized = section("anonymized")
    assert anonymized["whitelist"] == list(WHITELIST), anonymized
    assert anonymized["hostile_flush"] == {"ok": True, "value": 1}, anonymized
    assert anonymized["hostile_keys"] == "duration_ms,event,success,tool", anonymized
    assert anonymized["hostile_extra_dropped"] is True, anonymized
    assert anonymized["all_lines_whitelisted"] is True, anonymized
    assert anonymized["line_count"] == 5, anonymized

    enabled = section("enabled")
    for event in enabled["events"]:
        assert set(event).issubset(
            {"event", "host", "tool", "duration_ms", "success", "duration_s", "tools_used"}
        ), event
        assert "://" not in json.dumps(event), event


def test_privacy_no_secrets() -> None:
    """No secret from the store reaches the log or this driver's output."""
    privacy = section("privacy")
    assert privacy["marker_labels"] == [
        "github_token",
        "provider_api_key",
        "repository_url",
        "local_path",
    ], privacy
    assert privacy["markers_checked"] == len(SECRETS), privacy
    assert privacy["secrets_in_log"] == [], privacy
    assert privacy["secrets_in_config"] >= 1, privacy
    assert privacy["events_carry_no_url"] is True, privacy

    for secret in SECRETS:
        assert secret not in _RAW, f"the harness output carries {secret!r}"
    assert LOG_NAME in str(section("enabled")["log_summary"]), section("enabled")["log_summary"]


def main() -> int:
    failures = 0
    for name, candidate in sorted(globals().items()):
        if not name.startswith("test_") or not callable(candidate):
            continue
        try:
            candidate()
        except AssertionError as error:
            failures += 1
            print(f"FAIL {name}: {error}")
        else:
            print(f"ok {name}")
    return 1 if failures else 0


raise SystemExit(main())
