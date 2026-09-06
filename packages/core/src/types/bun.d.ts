// Makes Bun builtin modules (`bun:sqlite`, `bun:test`, …) visible to tsc
// without touching frozen tsconfig.base.json. `bun-types` (root devDep,
// installed for P-030) is Bun's official types package. P-061 plans
// `@types/bun` + `@types/node` + a tsconfig `types` field — note that
// `@types/bun` is deprecated upstream in favour of `bun-types`, so P-061
// should wire `types: ["bun-types", "node"]` instead and can delete this
// file once it does.
// See: https://bun.sh/docs/typescript
/// <reference types="bun-types" />

export {};
