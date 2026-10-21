# P-336 - the TypeScript/JavaScript resolver tests (the mandated ids).
#
# The CI is bun-only, so the python tests drive the real resolver through the
# bun harness (packages/core/src/__tests__/fixtures/ts-resolver-harness.ts):
# the harness copies the ground-truth fixture repo into a temp workspace, asks
# the resolver for every import and prints one `RESOLVE {json}` line.
#
# The compiler-API path IS the fallback the spec asks for, so the four
# mandated ids assert its answers; the language-server path is reported
# separately by the harness (a missing server must never fail the run).

import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
HARNESS = REPO_ROOT / 'packages/core/src/__tests__/fixtures/ts-resolver-harness.ts'

_REPORT: dict | None = None


def run_harness() -> dict:
    """Run the bun harness and return its report."""
    proc = subprocess.run(
        ['bun', str(HARNESS)],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )
    line = next((row for row in proc.stdout.splitlines() if row.startswith('RESOLVE ')), None)
    if line is None:
        raise AssertionError(
            f'the harness printed no RESOLVE line (exit {proc.returncode})\n'
            f'{proc.stdout}\n{proc.stderr}'
        )
    return json.loads(line[len('RESOLVE ') :])


def report() -> dict:
    """The harness report, computed once."""
    global _REPORT
    if _REPORT is None:
        _REPORT = run_harness()
    return _REPORT


def case(name: str) -> dict:
    """The report entry of one ground-truth case."""
    for entry in report()['cases']:
        if entry['name'] == name:
            return entry
    raise AssertionError(f"the report has no case {name}: {report()['cases']}")


def test_relative_imports():
    entry = case('relative')
    assert entry['ok'] is True, entry
    assert entry['target'] == 'src/helper.ts', entry
    assert entry['confidence'] == 'heuristic-medium', entry
    assert entry['source'] == 'src/index.ts', entry


def test_alias_imports():
    entry = case('alias')
    assert entry['ok'] is True, entry
    assert entry['target'] == 'src/aliased.ts', entry


def test_node_modules():
    entry = case('node_modules')
    assert entry['ok'] is True, entry
    assert entry['target'] == 'node_modules/fake-pkg/index.d.ts', entry


def test_fallback_accuracy():
    # The compiler-API path answers every ground-truth case: the fallback is
    # accurate, not a guess.
    assert report()['mode'] == 'compiler', report()
    assert report()['allOk'] is True, report()
    assert report()['accuracy'] == '4/4', report()


def main() -> int:
    failures = 0
    for name, test in sorted(globals().items()):
        if not name.startswith('test_') or not callable(test):
            continue
        try:
            test()
            print(f'ok {name}')
        except AssertionError as error:
            failures += 1
            print(f'FAIL {name}: {error}')
    if failures:
        print(f'{failures} test(s) failed')
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
