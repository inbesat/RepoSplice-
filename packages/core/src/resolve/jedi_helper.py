"""P-337 - the jedi bridge for the Python resolver.

Resolves ONE import specifier inside a file with jedi and prints a single JSON
line: {"targets": ["<absolute path>", ...]}. jedi is a python package, so the
node resolver reaches it through this script instead of importing it in node.

Usage: python jedi_helper.py <file> <specifier> [workspace-root] [sys-path ...]

The workspace root is put on the project path so an absolute import (a package
that lives beside the file) resolves the way it would on the real sys.path;
extra sys paths may follow the root.
"""

import json
import sys


def find_definitions(path, specifier, root, extra_paths=()):
    """The files the specifier points at, resolved by jedi."""
    import jedi  # the dependency is optional - the caller reports its absence

    project = jedi.Project(root, sys_path=[root, *extra_paths])
    script = jedi.Script(path=path, project=project)
    tail = specifier.rsplit(".", 1)[-1]
    with open(path, encoding="utf-8") as handle:
        lines = handle.read().splitlines()
    preferred = []
    fallback = []
    for name in script.get_names(all_scopes=True, references=False):
        if name.line < 1 or name.line > len(lines):
            continue
        if tail not in lines[name.line - 1]:
            continue
        try:
            definitions = name.goto()
        except Exception:  # a broken name must not kill the whole bridge
            continue
        for definition in definitions:
            target = definition.module_path
            if not target:
                continue
            path_text = str(target)
            fallback.append(path_text)
            # The definition whose file is named after the specifier is the one
            # the import points at (a package's __init__ is a weaker answer).
            stem = path_text.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
            if stem in (tail, tail + ".py"):
                preferred.append(path_text)
    return preferred or fallback


def main(argv):
    """Print the resolved targets as one JSON line."""
    if len(argv) < 3:
        print(json.dumps({"error": "the helper needs <file> <specifier> [root]"}))
        return 2
    path, specifier = argv[1], argv[2]
    root = argv[3] if len(argv) > 3 else path
    extra_paths = argv[4:]
    try:
        targets = find_definitions(path, specifier, root, extra_paths)
    except ImportError as error:
        print(json.dumps({"error": "jedi is not available: %s" % error}))
        return 3
    print(json.dumps({"targets": targets}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
