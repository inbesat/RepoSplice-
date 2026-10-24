#!/usr/bin/env python3
"""Guard the published MCP_QUICKSTART.md.

The quickstart is the only path a new user has from zero to a completed merge
over MCP, so these checks cover the two ways it can go wrong: a section that was
edited away, and an example session that names a tool or an install command the
server does not actually have. The tool list and the install commands are read
from MCP_REGISTRY_ENTRY.json, which is derived from the server itself (P-364),
so the document cannot drift from the implementation without failing here.

    uv run --no-project python docs/test_mcp_quickstart.py
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
QUICKSTART = REPO_ROOT / "MCP_QUICKSTART.md"
README_MD = REPO_ROOT / "README.md"
EVAL_MD = REPO_ROOT / "EVAL.md"
MCP_COMPAT_MD = REPO_ROOT / "MCP_COMPAT.md"
REGISTRY_ENTRY = REPO_ROOT / "MCP_REGISTRY_ENTRY.json"

REQUIRED_SECTIONS = (
    "## Prerequisites",
    "## Installation",
    "## Configuration",
    "## Example Session",
    "## Tool Reference",
    "## Progress Streaming",
    "## Troubleshooting",
    "## Host-Specific Notes",
)

TOOL_CALL_RE = re.compile(r"\bstitch_[a-z0-9_]+\b")


def read_text(path: Path) -> str:
    assert path.exists(), f"{path.name} does not exist"
    return path.read_text(encoding="utf-8")


def registry_entry() -> dict[str, object]:
    assert REGISTRY_ENTRY.exists(), "MCP_REGISTRY_ENTRY.json does not exist"
    entry = json.loads(REGISTRY_ENTRY.read_text(encoding="utf-8"))
    assert isinstance(entry, dict), "the registry entry is not a JSON object"
    return entry


def registered_tools(entry: dict[str, object]) -> list[str]:
    tools = entry.get("tools")
    assert isinstance(tools, list) and tools, "the registry entry lists no tools"
    return [str(name) for name in tools]


def installation(entry: dict[str, object]) -> dict[str, str]:
    value = entry.get("installation")
    assert isinstance(value, dict), "the registry entry carries no installation block"
    stdio = value.get("stdio")
    http = value.get("http")
    assert isinstance(stdio, str) and stdio, "the registry entry carries no stdio command"
    assert isinstance(http, str) and http, "the registry entry carries no http command"
    return {"stdio": stdio, "http": http}


def section_body(document: str, header: str) -> str:
    """The text of one `## ` section, from its header to the next one."""
    start = document.index(header) + len(header)
    rest = document[start:]
    end = rest.find("\n## ")
    return rest if end < 0 else rest[:end]


def test_sections_present() -> None:
    document = read_text(QUICKSTART)
    for section in REQUIRED_SECTIONS:
        assert section in document, f"the quickstart is missing the {section!r} section"
    assert "MCP_COMPAT.md" in document, "the quickstart does not link the host compatibility doc"
    assert "MCP_QUICKSTART.md" in read_text(README_MD), "README.md does not link the quickstart"
    assert "MCP_QUICKSTART.md" in read_text(EVAL_MD), "EVAL.md does not link the quickstart"
    assert MCP_COMPAT_MD.exists(), "MCP_COMPAT.md does not exist"
    entry = registry_entry()
    assert "MCP_QUICKSTART.md" in json.dumps(entry), "the registry entry does not link the quickstart"


def test_example_session_valid() -> None:
    document = read_text(QUICKSTART)
    entry = registry_entry()
    tools = registered_tools(entry)
    commands = installation(entry)

    assert commands["stdio"] in document, "the quickstart does not show the stdio install command"
    assert commands["http"] in document, "the quickstart does not show the http install command"

    for name in sorted(set(TOOL_CALL_RE.findall(document))):
        assert name in tools, f"the quickstart names {name}, which the server does not register"

    for name in tools:
        assert name in document, f"the tool reference omits {name}"

    session = section_body(document, "## Example Session")
    select_at = session.index("stitch_select_files")
    merge_at = session.index("stitch_merge")
    status_at = session.index("stitch_job_status")
    assert select_at < merge_at < status_at, "the example session is not select -> merge -> monitor"

    assert "not submitted" in document, "the quickstart claims a registry status the entry does not have"


def main() -> int:
    failures = 0
    for name, function in sorted(globals().items()):
        if not name.startswith("test_") or not callable(function):
            continue
        try:
            function()
        except AssertionError as error:
            print(f"FAIL {name}: {error}")
            failures += 1
        else:
            print(f"ok {name}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
