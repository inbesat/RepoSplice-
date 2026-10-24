"""P-362 mandated ids: the MCP server shares the CLI config, redacts secrets and
validates the fields it needs.

Standalone script (NOT pytest), driven by the bun harness at
packages/mcp/src/__fixtures__/config-harness.ts, which loads a real
`~/.stitch/config.json`-shaped store and drives a real tool through a real
MCPServer. Run it with:

    uv run --no-project python packages/mcp/test_config.py
"""

import json
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
HARNESS = REPO_ROOT / "packages/mcp/src/__fixtures__/config-harness.ts"

CONFIG_FILE = "config.json"
REDACTED = "[REDACTED]"
GITHUB_FIELD = "github"
AI_FIELD = "ai.provider"
SANDBOX_FIELD = "sandbox"
THRESHOLD_FIELD = "confidence.auto_approve_threshold"

# The literals the harness writes into the store. None of them may appear in any
# output the server produces, log lines included (P-010/P-037).
SECRETS = ("ghp_harness_github_secret", "sk-ant-harness-secret", "nested-credentials-secret")

_REPORT = None
_RAW = None


def run_harness():
    """Run the bun harness once and return its parsed CONFIG payload."""
    global _REPORT, _RAW  # noqa: PLW0603 - one cached run per process
    if _REPORT is not None:
        return _REPORT

    completed = subprocess.run(
        ["bun", str(HARNESS)],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )
    stdout = completed.stdout
    if completed.returncode != 0:
        raise AssertionError(
            "the harness failed with code {code}:\n{err}".format(
                code=completed.returncode, err=completed.stderr or stdout
            )
        )

    line = next((row for row in stdout.splitlines() if row.startswith("CONFIG ")), None)
    if line is None:
        raise AssertionError("the harness printed no CONFIG line:\n" + stdout)

    _RAW = stdout
    _REPORT = json.loads(line[len("CONFIG ") :])
    return _REPORT


def section(name):
    report = run_harness()
    assert name in report, "the harness reported no {name} section".format(name=name)
    return report[name]


def test_shared_config_works():
    """One config file serves both the CLI and the MCP server."""
    shared = section("shared")

    assert shared["path_endswith"] is True, shared
    assert shared["path_matches_loaded"] is True, shared
    assert shared["present"] is True, shared
    assert shared["absent_reads_empty"] is True, shared

    assert shared["github_has_token"] is True, shared
    assert shared["auth_type"] == "pat", shared
    assert shared["providers"] == ["anthropic"], shared
    assert shared["providers_with_env"] == ["anthropic", "openrouter"], shared

    assert shared["sandbox_configured"] is True, shared
    assert shared["sandbox_backend"] == "docker", shared
    assert shared["sandbox_mode"] == "auto", shared
    assert shared["sandbox_network_allow"] is False, shared
    assert shared["threshold"] == 80, shared

    summary = shared["summary"]
    assert CONFIG_FILE in summary, summary
    assert "github: token" in summary, summary
    assert "ai: anthropic" in summary, summary
    assert "threshold: 80" in summary, summary

    validated = shared["validated"]
    assert validated["ok"] is True, validated
    assert validated["validated"] == ["github", "ai", "sandbox", "confidence"], validated

    # A tool still works from the same config: no second credential flow.
    tool = section("tool")
    assert tool["registered"] is True, tool
    assert tool["tool_count"] == 1, tool
    assert tool["is_error"] is False, tool
    assert tool["paths"] == ["src/index.ts"], tool

    # Nothing is cached, so an edited file is what the next start reads.
    nocache = section("nocache")
    assert nocache["before"] == [], nocache
    assert nocache["after"] == ["anthropic"], nocache


def test_secrets_redacted():
    """No secret reaches the snapshot, the summary or any output byte."""
    redacted = section("redacted")

    assert redacted["secrets_in_snapshot"] is False, redacted
    assert redacted["secrets_in_summary"] is False, redacted
    assert redacted["secrets_in_payload"] is False, redacted

    assert redacted["redacted_token"] == REDACTED, redacted
    assert redacted["redacted_api_key"] == REDACTED, redacted
    assert redacted["redacted_nested_credentials"] == REDACTED, redacted
    assert redacted["sandbox_untouched"] == '{"backend":"docker","mode":"auto","networkAllow":false}', redacted

    assert redacted["redact_paths_cover"] is True, redacted
    assert redacted["logger_ran"] is True, redacted

    raw = _RAW if _RAW is not None else run_harness()
    for secret in SECRETS:
        assert secret not in raw, "the harness leaked {secret!r} into its output".format(secret=secret)


def test_required_fields_validated():
    """The sections a merge needs are refused one at a time, in order."""
    required = section("required")

    for name in ("absent", "github_only", "github_ai"):
        refusal = required[name]
        assert refusal["ok"] is False, refusal
        assert refusal["code"] == "CONFIG_ERROR", refusal

    assert required["absent"]["field"] == GITHUB_FIELD, required["absent"]
    assert required["github_only"]["field"] == AI_FIELD, required["github_only"]
    assert required["github_ai"]["field"] == SANDBOX_FIELD, required["github_ai"]

    complete = required["complete"]
    assert complete["ok"] is True, complete
    assert complete["validated"] == ["github", "ai", "sandbox", "confidence"], complete

    threshold = required["bad_threshold"]
    assert threshold["ok"] is False, threshold
    assert threshold["code"] == "CONFIG_ERROR", threshold
    assert threshold["field"] == THRESHOLD_FIELD, threshold


def main():
    failures = 0
    for name, candidate in sorted(globals().items()):
        if not name.startswith("test_") or not callable(candidate):
            continue
        try:
            candidate()
        except AssertionError as error:
            failures += 1
            print("FAIL {name}: {error}".format(name=name, error=error))
        except Exception as error:  # noqa: BLE001 - report any driver error the same way
            failures += 1
            print("FAIL {name}: {error!r}".format(name=name, error=error))
        else:
            print("ok {name}".format(name=name))
    return 1 if failures else 0


raise SystemExit(main())
