"""P-359 — the `stitch_merge` / `stitch_job_status` / `stitch_cancel_job` tests (the mandated ids).

The CI is bun-only, so the python ids drive the real tool handlers and the
real MCP server through the bun harness
(packages/mcp/src/tools/__fixtures__/merge-harness.ts) and assert on the report
it prints. The job provider is injected: the core barrel exports `runPipeline`
but no job API (the job queue P-239 and the merge stage handlers stay inside
core), so the harness supplies an in-memory provider exactly the way
`packages/cli/src/commands/merge.ts` supplies its pipeline.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
HARNESS = REPO_ROOT / "packages/mcp/src/tools/__fixtures__/merge-harness.ts"

REPO_A = "https://example.invalid/a.git"
REPO_B = "https://example.invalid/b.git"
TOKEN = "tok-1"

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
        if line.startswith("MERGE "):
            _REPORT = json.loads(line[len("MERGE ") :])
            return _REPORT
    raise AssertionError(
        f"the harness printed no MERGE line: {proc.stdout}\n{proc.stderr}"
    )


def test_merge_returns_job() -> None:
    """stitch_merge starts a job and returns its identifier."""
    report = run_harness()
    merge = report["merge"]
    assert merge["ok"] is True, merge
    assert merge["payload"]["job_id"] == "job-1", merge
    assert report["created"] == {
        "repo_a": REPO_A,
        "repo_b": REPO_B,
        "paths_a": ["src"],
        "paths_b": ["src"],
    }, report["created"]
    # A merge with no source is refused on the missing field.
    no_source = report["no_source"]
    assert no_source["ok"] is False, no_source
    assert no_source["code"] == "CONFIG_ERROR", no_source
    assert no_source["field"] == "stitch_merge.repo_a", no_source


def test_job_status() -> None:
    """stitch_job_status reports the current status and progress."""
    report = run_harness()
    status = report["status"]
    assert status["ok"] is True, status
    assert status["payload"]["status"] == "running", status
    assert status["payload"]["progress"]["total"] == 3, status
    assert "result" not in status["payload"], status

    unknown = report["status_unknown"]
    assert unknown["ok"] is False, unknown
    assert unknown["code"] == "CONFIG_ERROR", unknown
    assert unknown["field"] == "stitch_job_status.job_id", unknown


def test_progress_notifications() -> None:
    """A progress token streams live updates and stops once the job settles."""
    report = run_harness()
    progress = report["progress"]
    assert progress["ok"] is True, progress
    assert progress["subscriptions"] == 1, progress
    assert progress["releases"] == 1, progress
    assert progress["methods"] == [
        "notifications/progress",
        "notifications/progress",
    ], progress
    assert progress["progresses"] == [1, 3], progress
    assert progress["totals"] == [3, 3], progress
    assert progress["tokens"] == [TOKEN, TOKEN], progress


def test_cancel() -> None:
    """stitch_cancel_job cancels the job, refuses an unknown one, and the
    default provider refuses honestly because the core barrel has no job API."""
    report = run_harness()
    cancel = report["cancel"]
    assert cancel["ok"] is True, cancel
    assert cancel["payload"]["status"] == "cancelled", cancel

    unknown = report["cancel_unknown"]
    assert unknown["ok"] is False, unknown
    assert unknown["code"] == "CONFIG_ERROR", unknown
    assert unknown["field"] == "stitch_cancel_job.job_id", unknown

    refusal = report["refusal"]
    assert refusal["ok"] is False, refusal
    assert refusal["code"] == "CONFIG_ERROR", refusal
    assert refusal["field"] == "mcp.core", refusal


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
