"""P-335 — the mandated LSP client tests.

They drive the real client through the bun harness (the CI is bun-only),
which prefers the real language server (typescript-language-server) and
falls back to the protocol-faithful stub.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
HARNESS = REPO_ROOT / "packages" / "core" / "src" / "__tests__" / "fixtures" / "lsp-client-harness.ts"


def run_harness() -> dict:
    """Run the harness and return its report."""
    proc = subprocess.run(
        ["bun", str(HARNESS)],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )
    for line in proc.stdout.splitlines():
        if line.startswith("LSP "):
            return json.loads(line[4:])
    raise AssertionError(
        "the lsp harness printed no LSP line "
        f"(exit {proc.returncode})\nstdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
    )


def test_initialize() -> None:
    report = run_harness()
    initialize = report["initialize"]
    assert initialize["ok"] is True, initialize
    assert "capabilities" in initialize, initialize
    assert initialize["capabilities"], initialize


def test_definition_request() -> None:
    report = run_harness()
    definition = report["definition"]
    assert definition["ok"] is True, definition
    assert "uri" in definition, definition


def test_concurrent_requests() -> None:
    report = run_harness()
    concurrent = report["concurrent"]
    assert concurrent["count"] == 3, concurrent
    assert concurrent["answered"] == 3, concurrent
    assert concurrent["allOk"] is True, concurrent
    assert concurrent["distinct"] >= 1, concurrent


def test_graceful_shutdown() -> None:
    report = run_harness()
    shutdown = report["shutdown"]
    assert shutdown["ok"] is True, shutdown
    assert shutdown["aliveAfter"] is False, shutdown


def main() -> int:
    failures = 0
    for name, test in sorted(globals().items()):
        if not name.startswith("test_") or not callable(test):
            continue
        try:
            test()
            print(f"ok {name}")
        except Exception as error:  # noqa: BLE001 - the runner reports every failure
            failures += 1
            print(f"FAIL {name}: {error}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
