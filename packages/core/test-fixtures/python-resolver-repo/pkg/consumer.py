"""The importer: every import kind the resolver has to handle."""

from typing import TYPE_CHECKING

import pkg.module
from .module import helper_value
from pkg.sub import child

if TYPE_CHECKING:
    from .typing_only import Marker


def use_relative() -> int:
    return helper_value


def use_submodule() -> int:
    return child.child_value


def use_absolute() -> int:
    return pkg.module.helper_value