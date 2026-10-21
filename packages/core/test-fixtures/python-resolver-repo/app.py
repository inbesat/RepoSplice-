"""The fixture entry point: an absolute package import.

The import is a FROM import on purpose: the symbol it binds lives in the
module that is imported, so the resolver's target is that module's file.
"""

from pkg.module import helper_value


def use_absolute() -> int:
    return helper_value
