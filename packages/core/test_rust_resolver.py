"""P-339 — the Rust resolver's mandated tests (best-effort).

Two assertions, and they are the two the spec asks for: the resolver answers
the ground-truth fixture through its module-graph fallback, and the
best-effort/tree-sitter priority is actually DOCUMENTED in ARCHITECTURE.md.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
HARNESS = (
    REPO_ROOT
    / "packages"
    / "core"
    / "src"
    / "__tests__"
    / "fixtures"
    / "rust-resolver-harness.ts"
)
ARCHITECTURE = REPO_ROOT / "project-plans" / "ARCHITECTURE.md"

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
    for line in proc.stdout.splitlines():
        if line.startswith("RESOLVE "):
            _REPORT = json.loads(line[len("RESOLVE ") :])
            return _REPORT
    raise AssertionError(
        f"the harness printed no RESOLVE line (exit {proc.returncode}): "
        f"{proc.stdout}\n{proc.stderr}"
    )


def case(name: str) -> dict:
    """The report entry of one ground-truth case."""
    for item in run_harness().get("cases", []):
        if item.get("name") == name:
            return item
    raise AssertionError(f"the report has no case {name}: {run_harness()}")


def test_basic_imports() -> None:
    """A crate import resolves through the module graph."""
    report = run_harness()
    entry = case("crate_module")
    assert entry["ok"] is True, entry
    assert entry["target"] == "src/a.rs", entry
    assert entry["confidence"] == "heuristic-medium", entry
    # The rest of the fixture: the mod tree, a self:: path, a cfg-gated
    # module (which must stay unresolved).
    assert case("mod_tree")["ok"] is True, case("mod_tree")
    assert case("self_module")["ok"] is True, case("self_module")
    assert case("cfg_gated")["ok"] is True, case("cfg_gated")
    assert report["allOk"] is True, report
    assert report["accuracy"] == f"{len(report['cases'])}/{len(report['cases'])}", report


def test_fallback_documented() -> None:
    """ARCHITECTURE.md carries the best-effort note and the fallback priority."""
    text = ARCHITECTURE.read_text(encoding="utf-8")
    assert "New Language Resolver" in text, "the resolver extension point is missing"
    assert "best-effort" in text, "the best-effort note is missing"
    assert "tree-sitter" in text, "the tree-sitter fallback priority is missing"
    assert "P-339" in text, "the note does not name the phase"


def main() -> int:
    """Run every test in this file and report the result."""
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
