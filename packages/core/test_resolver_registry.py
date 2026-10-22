"""P-341 — the resolver registry's mandated tests.

The CI is bun-only, so the python ids drive the real registry through a bun
harness (packages/core/src/__tests__/fixtures/resolver-registry-harness.ts) and
assert on its report: the five resolvers implement the DependencyResolver
contract, the registry picks the right resolver per ecosystem, and the
LSP -> Heuristic -> None chain holds.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
HARNESS = (
    REPO_ROOT / "packages" / "core" / "src" / "__tests__" / "fixtures" / "resolver-registry-harness.ts"
)

_REPORT: dict | None = None

EXPECTED_LANGUAGES = ("typescript", "python", "go", "rust", "heuristic")


def run_harness() -> dict:
    """Drive the harness once and return its report."""
    global _REPORT
    if _REPORT is not None:
        return _REPORT
    proc = subprocess.run(["bun", str(HARNESS)], cwd=REPO_ROOT, capture_output=True, text=True)
    if proc.returncode != 0:
        raise AssertionError(
            f"the harness failed ({proc.returncode}): {proc.stdout}\n{proc.stderr}"
        )
    for line in proc.stdout.splitlines():
        if line.startswith("RESOLVE "):
            _REPORT = json.loads(line[len("RESOLVE ") :])
            return _REPORT
    raise AssertionError(f"the harness printed no RESOLVE line: {proc.stdout}\n{proc.stderr}")


def test_interface_compliance() -> None:
    """All five resolvers answer the whole contract."""
    report = run_harness()
    compliance = report["compliance"]
    assert len(compliance) == 5, compliance
    assert [item["language"] for item in compliance] == list(EXPECTED_LANGUAGES), compliance
    for item in compliance:
        assert item["capabilities"]["language"] == item["language"], item
        assert item["capabilities"]["strategies"], item
        assert item["capabilities"]["lsp"] in ("configured", "absent"), item
        assert item["healthOk"] is True, item
        assert item["healthy"] is True, item
        assert item["shutdownOk"] is True, item


def test_ecosystem_selection() -> None:
    """Each ecosystem gets the resolver that speaks its language."""
    report = run_harness()
    assert report["selection"] == {
        "node": "typescript",
        "python": "python",
        "go": "go",
        "rust": "rust",
    }, report["selection"]
    assert report["unknownResolver"] is None, report
    for entry in report["capabilities"]:
        assert entry["ecosystem"] in ("node", "python", "go", "rust"), entry
        assert entry["language"] in EXPECTED_LANGUAGES, entry


def test_fallback_chain() -> None:
    """The chain is LSP -> Heuristic -> None, and it really resolves."""
    report = run_harness()
    assert report["chain"]["auto"] == ["typescript", "heuristic"], report["chain"]
    assert report["chain"]["never"] == ["heuristic"], report["chain"]
    assert report["chain"]["unknown"] == [], report["chain"]
    resolution = report["resolution"]
    assert resolution["ok"] is True, resolution
    assert resolution["target"] == "src/helper.ts", resolution
    assert resolution["confidence"] == "heuristic-medium", resolution


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
