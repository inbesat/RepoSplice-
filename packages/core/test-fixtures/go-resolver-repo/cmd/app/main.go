package main

import (
	depthing "example.com/dep/thing"
	otherpkg "example.com/other/pkg"
	fixpkg "example.com/fixture/pkg"
	fixplain "example.com/fixture/tagged"
)

func main() {
	_ = depthing.Thing
	_ = otherpkg.OtherValue
	_ = fixpkg.Value
	_ = fixplain.Plain
}