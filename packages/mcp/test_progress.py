"""P-361 — the MCP progress streaming tests (the mandated ids).

The CI is bun-only, so the python ids drive the real `stitch_merge` /
`stitch_job_status` handlers through the bun harness
(packages/mcp/src/tools/__fixtures__/progress-harness.ts) and assert on the
report it prints. The job provider is injected: the core barrel exports
`runPipeline` but no job API (the job queue P-239 and the merge stage handlers
stay inside core - ADR-168).
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
HARNESS = REPO_ROOT / "packages/mcp/src/tools/__fixtures__/progress-harness.ts"

TOKEN = "tok-1"
TOTAL = 100

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
        if line.startswith("PROGRESS "):
            _REPORT = json.loads(line[len("PROGRESS ") :])
            return _REPORT
    raise AssertionError(
        f"the harness printed no PROGRESS line: {proc.stdout}\n{proc.stderr}"
    )


def test_progress_emitted() -> None:
    """stitch_merge accepts a progress token and streams a frame per snapshot."""
    report = run_harness()
    emitted = report["emitted"]
    assert emitted["ok"] is True, emitted
    assert emitted["payload"]["job_id"] == "job-1", emitted
    assert emitted["subscriptions"] == 1, emitted
    assert emitted["releases"] == 1, emitted
    assert emitted["methods"] == [
        "notifications/progress",
        "notifications/progress",
    ], emitted
    assert emitted["tokens"] == [TOKEN, TOKEN], emitted
    assert emitted["progresses"] == [40, TOTAL], emitted
    assert emitted["totals"] == [TOTAL, TOTAL], emitted

    # A token that is neither a string nor a number is refused on its own field.
    refusal = report["refusal"]
    assert refusal["ok"] is False, refusal
    assert refusal["code"] == "CONFIG_ERROR", refusal
    assert refusal["field"] == "stitch_merge.progress_token", refusal


def test_completion_event() -> None:
    """The final frame of a settled job reports progress === total."""
    report = run_harness()
    completion = report["completion"]
    assert completion["count"] == 2, completion
    assert completion["last_total"] == TOTAL, completion
    assert completion["last_progress"] == completion["last_total"], completion
    assert completion["releases"] == 1, completion

    status = completion["status"]
    assert status["ok"] is True, status
    assert status["payload"]["status"] == "succeeded", status
    assert status["payload"]["progress"]["total"] == TOTAL, status


def test_backward_compat() -> None:
    """With no progress token nothing is subscribed and polling still works."""
    report = run_harness()
    backward = report["backward"]
    assert backward["ok"] is True, backward
    assert backward["payload"]["job_id"] == "job-1", backward
    assert backward["subscriptions"] == 0, backward
    assert backward["releases"] == 0, backward
    assert backward["notifications"] == 0, backward

    status = backward["status"]
    assert status["ok"] is True, status
    assert status["payload"]["status"] == "running", status
    assert status["payload"]["progress"]["total"] == TOTAL, status
    assert "result" not in status["payload"], status


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
