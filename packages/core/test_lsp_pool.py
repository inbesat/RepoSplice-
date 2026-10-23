"""P-344 — the LSP warm-pool tests (the mandated ids).

The CI is bun-only, so the python tests drive the real pool through the bun
harness (packages/core/src/__tests__/fixtures/lsp-pool-harness.ts). The harness
measures the pool hermetically over the stub server and also attempts the real
typescript-language-server for the record.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
HARNESS = REPO_ROOT / "packages/core/src/__tests__/fixtures/lsp-pool-harness.ts"

_REPORT: dict | None = None


def run_harness() -> dict:
    """Run the harness once and return its report."""
    global _REPORT
    if _REPORT is not None:
        return _REPORT
    proc = subprocess.run(
        ["bun", str(HARNESS)],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )
    line = next(
        (row for row in proc.stdout.splitlines() if row.startswith("POOL ")),
        None,
    )
    if line is None:
        raise AssertionError(
            f"the harness printed no POOL line (exit {proc.returncode})\n"
            f"{proc.stdout}\n{proc.stderr}"
        )
    _REPORT = json.loads(line[len("POOL ") :])
    return _REPORT


def test_reuse() -> None:
    """One server is started per ecosystem and every later call reuses it."""
    report = run_harness()
    stub = report["stub"]
    assert stub["ok"] is True, stub
    assert stub["reuse"]["created"] == 1, stub["reuse"]
    assert stub["reuse"]["reused"] >= 1, stub["reuse"]
    assert stub["reuse"]["sameInstance"] is True, stub["reuse"]


def test_warm_latency() -> None:
    """A warm request stays under the 200ms bar and beats the cold start."""
    report = run_harness()
    warm = report["stub"]["warm"]
    assert warm["ok"] is True, warm
    assert warm["warmMs"] < 200, warm
    assert warm["warmMs"] < max(warm["coldMs"], 1), warm
    assert warm["samples"] >= 1, warm


def test_idle_timeout() -> None:
    """An unused server is shut down and a later call starts a fresh one."""
    report = run_harness()
    idle = report["idle"]
    assert idle["ok"] is True, idle
    assert idle["idleShutdowns"] == 1, idle
    assert idle["createdAfterExpiry"] == 2, idle


def test_health_check() -> None:
    """A live server is healthy, an unconfigured ecosystem is absent, a dead
    server is dropped so the next call reconnects."""
    report = run_harness()
    health = report["stub"]["health"]
    assert health["live"]["ok"] is True, health
    assert health["live"]["healthy"] is True, health
    assert health["live"]["present"] is True, health
    assert health["missing"]["ok"] is True, health
    assert health["missing"]["present"] is False, health
    assert health["dead"]["ok"] is True, health
    assert health["dead"]["healthy"] is False, health
    assert health["recreated"] is True, health


def main() -> int:
    failures = 0
    for name, test in sorted(globals().items()):
        if not name.startswith("test_") or not callable(test):
            continue
        try:
            test()
        except AssertionError as error:
            print(f"FAIL {name}: {error}")
            failures += 1
        else:
            print(f"ok {name}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
