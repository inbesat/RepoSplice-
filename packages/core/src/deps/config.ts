// Config files merge for tsconfig, vite, eslint and generic JSON (P-113).
//
// Beyond `package.json`, repos have `tsconfig.json`, `vite.config.ts`,
// `eslint.config.mjs` that may conflict (different compilerOptions.target,
// plugins, rules). This module deep-merges JSON configs with conflict
// detection, producing a merged config that extends both via `extends`
// array where possible, else reports a `config` conflict for AI/human.
//
// Safety contract (P-011):
// - No throws: inputs are `unknown`; non-object inputs are handled as
//   conflicts, not exceptions. Every path returns a freshly constructed
//   result, never throws.
// - Pure: inputs are never mutated; every result is freshly constructed.
// - Only config keys and values reach conflicts — never file contents
//   beyond the parsed JSON.

import type { Conflict } from './types.js';

export interface ConfigMergeResult {
  merged: unknown;
  conflicts: Conflict[];
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? [...value] : [value];
}

function unionArrays<T>(a: T[], b: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of [...a, ...b]) {
    const key = JSON.stringify(item);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

function dedupeByName(plugins: unknown[]): unknown[] {
  const seen = new Set<string>();
  const out: unknown[] = [];
  for (const p of plugins) {
    let name: string | undefined;
    if (typeof p === 'string') name = p;
    else if (isPlainObject(p) && typeof p.name === 'string') name = p.name;
    else name = JSON.stringify(p);
    if (!seen.has(name)) {
      seen.add(name);
      out.push(p);
    }
  }
  return out;
}

// tsconfig target ranking: higher is more modern
const TS_TARGET_RANK: Record<string, number> = {
  es3: 0,
  es5: 1,
  es6: 2,
  es2015: 2,
  es2016: 3,
  es2017: 4,
  es2018: 5,
  es2019: 6,
  es2020: 7,
  es2021: 8,
  es2022: 9,
  esnext: 10,
};

function pickHigherTarget(a: string, b: string): string {
  const rankA = TS_TARGET_RANK[a.toLowerCase()] ?? -1;
  const rankB = TS_TARGET_RANK[b.toLowerCase()] ?? -1;
  if (rankA === -1 && rankB === -1) return a;
  return rankA >= rankB ? a : b;
}

// ---------------------------------------------------------------------------
// generic deep merge with conflict detection
// ---------------------------------------------------------------------------

export function mergeGenericJson(a: unknown, b: unknown, path: string): ConfigMergeResult {
  const conflicts: Conflict[] = [];

  function mergeAt(x: unknown, y: unknown, curPath: string): unknown {
    // Both undefined -> undefined (should not happen via recursion, but safe)
    if (x === undefined) return y;
    if (y === undefined) return x;

    // Primitives or mismatched types: collision if not equal
    const xIsObj = isPlainObject(x);
    const yIsObj = isPlainObject(y);
    const xIsArr = Array.isArray(x);
    const yIsArr = Array.isArray(y);

    if (xIsArr && yIsArr) {
      // Union if primitives, else conflict + concat for objects? Spec: array → union if primitives else conflict.
      const arrX = x as unknown[];
      const arrY = y as unknown[];
      const allPrimitive = [...arrX, ...arrY].every(v => v === null || typeof v !== 'object');
      if (allPrimitive) {
        return unionArrays(arrX, arrY);
      }
      // For object arrays (e.g. plugins), compare via JSON stringify; if any differing structure, still union if possible
      // Spec says else conflict — we treat as conflict when arrays contain objects with different shapes
      // Simple heuristic: if every element is plain object with `name`, dedupe by name; else conflict
      const hasNameField = [...arrX, ...arrY].every(
        v => isPlainObject(v) && typeof v.name === 'string'
      );
      if (hasNameField) {
        return dedupeByName([...arrX, ...arrY]);
      }
      // Primitive mismatch already handled; for mixed object arrays, report conflict and keep union
      if (JSON.stringify(arrX) !== JSON.stringify(arrY)) {
        conflicts.push({
          type: 'config',
          package: curPath,
          values: { 'repo-a': JSON.stringify(x), 'repo-b': JSON.stringify(y) },
          severity: 'warning',
        });
        return unionArrays(arrX, arrY);
      }
      return arrX;
    }

    if (xIsObj && yIsObj) {
      const out: Record<string, unknown> = { ...(x as Record<string, unknown>) };
      for (const [key, valY] of Object.entries(y as Record<string, unknown>)) {
        const valX = (x as Record<string, unknown>)[key];
        if (!(key in (x as Record<string, unknown>))) {
          out[key] = valY;
        } else if (JSON.stringify(valX) === JSON.stringify(valY)) {
          out[key] = valX;
        } else {
          const nextPath = curPath ? `${curPath}.${key}` : key;
          // Recurse for objects, else conflict
          if (isPlainObject(valX) && isPlainObject(valY)) {
            out[key] = mergeAt(valX, valY, nextPath);
          } else if (Array.isArray(valX) && Array.isArray(valY)) {
            out[key] = mergeAt(valX, valY, nextPath);
          } else {
            conflicts.push({
              type: 'config',
              package: nextPath,
              values: { 'repo-a': String(valX), 'repo-b': String(valY) },
              severity: 'warning',
            });
            // Keep first side's value (P-011 first-wins for non-resolvable)
            out[key] = valX;
          }
        }
      }
      return out;
    }

    // Primitive collision with differing values
    if (x !== y) {
      conflicts.push({
        type: 'config',
        package: curPath || path,
        values: { 'repo-a': String(x), 'repo-b': String(y) },
        severity: 'warning',
      });
      return x;
    }
    return x;
  }

  const merged = mergeAt(a, b, path);
  return { merged, conflicts };
}

// ---------------------------------------------------------------------------
// tsconfig
// ---------------------------------------------------------------------------

export function mergeTsConfig(a: unknown, b: unknown): ConfigMergeResult {
  const conflicts: Conflict[] = [];

  const objA = isPlainObject(a) ? (a as Record<string, unknown>) : {};
  const objB = isPlainObject(b) ? (b as Record<string, unknown>) : {};

  const merged: Record<string, unknown> = {};

  // extends: string | string[] → union
  const extendsA = asArray<string>(objA.extends as string | string[] | undefined);
  const extendsB = asArray<string>(objB.extends as string | string[] | undefined);
  if (extendsA.length > 0 || extendsB.length > 0) {
    const union = unionArrays(extendsA, extendsB);
    if (union.length === 1) merged.extends = union[0];
    else if (union.length > 1) merged.extends = union;
  }

  // compilerOptions deep merge with target/module conflict handling
  const coA = isPlainObject(objA.compilerOptions)
    ? (objA.compilerOptions as Record<string, unknown>)
    : undefined;
  const coB = isPlainObject(objB.compilerOptions)
    ? (objB.compilerOptions as Record<string, unknown>)
    : undefined;

  if (coA === undefined && coB === undefined) {
    // nothing
  } else if (coA === undefined) {
    merged.compilerOptions = { ...coB! };
  } else if (coB === undefined) {
    merged.compilerOptions = { ...coA };
  } else {
    const coMerged: Record<string, unknown> = { ...coA };
    for (const [key, valB] of Object.entries(coB)) {
      const valA = coA[key];
      if (!(key in coA)) {
        coMerged[key] = valB;
        continue;
      }
      if (JSON.stringify(valA) === JSON.stringify(valB)) continue;

      const pkg = `tsconfig.compilerOptions.${key}`;
      if (
        (key === 'target' || key === 'module') &&
        typeof valA === 'string' &&
        typeof valB === 'string'
      ) {
        conflicts.push({
          type: 'config',
          package: pkg,
          values: { 'repo-a': valA, 'repo-b': valB },
          severity: 'warning',
        });
        // Pick higher target/module (esnext > es2020 > es2018)
        coMerged[key] =
          key === 'target' ? pickHigherTarget(valA, valB) : pickHigherTarget(valA, valB);
      } else if (isPlainObject(valA) && isPlainObject(valB)) {
        const generic = mergeGenericJson(valA, valB, pkg);
        coMerged[key] = generic.merged;
        conflicts.push(...generic.conflicts);
      } else if (Array.isArray(valA) && Array.isArray(valB)) {
        const generic = mergeGenericJson(valA, valB, pkg);
        coMerged[key] = generic.merged;
        conflicts.push(...generic.conflicts);
      } else {
        conflicts.push({
          type: 'config',
          package: pkg,
          values: { 'repo-a': String(valA), 'repo-b': String(valB) },
          severity: 'warning',
        });
        // Keep higher-ranked or first side
        coMerged[key] = valA;
      }
    }
    merged.compilerOptions = coMerged;
  }

  // references, include, exclude → union
  for (const key of ['references', 'include', 'exclude', 'files'] as const) {
    const arrA = asArray<unknown>(objA[key] as unknown[] | undefined);
    const arrB = asArray<unknown>(objB[key] as unknown[] | undefined);
    if (arrA.length === 0 && arrB.length === 0) continue;
    const union = unionArrays(arrA, arrB);
    // references is array of objects { path: string } — union via JSON stringify handles it
    merged[key] = union;
  }

  // Preserve any other top-level keys via generic merge (excluding handled ones)
  const handled = new Set([
    'extends',
    'compilerOptions',
    'references',
    'include',
    'exclude',
    'files',
  ]);
  const remainingA: Record<string, unknown> = {};
  const remainingB: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(objA)) if (!handled.has(k)) remainingA[k] = v;
  for (const [k, v] of Object.entries(objB)) if (!handled.has(k)) remainingB[k] = v;
  if (Object.keys(remainingA).length > 0 || Object.keys(remainingB).length > 0) {
    const generic = mergeGenericJson(remainingA, remainingB, 'tsconfig');
    const genMerged = isPlainObject(generic.merged)
      ? (generic.merged as Record<string, unknown>)
      : {};
    Object.assign(merged, genMerged);
    conflicts.push(...generic.conflicts);
  }

  // Handle non-object inputs (should not happen for tsconfig, but safe)
  if (!isPlainObject(a) && !isPlainObject(b)) {
    const generic = mergeGenericJson(a, b, 'tsconfig');
    return generic;
  }

  return { merged, conflicts };
}

// ---------------------------------------------------------------------------
// vite config
// ---------------------------------------------------------------------------

export function mergeViteConfig(a: unknown, b: unknown): ConfigMergeResult {
  const conflicts: Conflict[] = [];

  const objA = isPlainObject(a) ? (a as Record<string, unknown>) : {};
  const objB = isPlainObject(b) ? (b as Record<string, unknown>) : {};

  const merged: Record<string, unknown> = { ...objA };

  for (const [key, valB] of Object.entries(objB)) {
    const valA = objA[key];
    if (!(key in objA)) {
      merged[key] = valB;
      continue;
    }
    if (JSON.stringify(valA) === JSON.stringify(valB)) continue;

    if (key === 'plugins' && Array.isArray(valA) && Array.isArray(valB)) {
      const concat = [...(valA as unknown[]), ...(valB as unknown[])];
      merged[key] = dedupeByName(concat);
      continue;
    }

    if (key === 'build' && isPlainObject(valA) && isPlainObject(valB)) {
      const generic = mergeGenericJson(valA, valB, 'vite.build');
      merged[key] = generic.merged;
      conflicts.push(...generic.conflicts);
      continue;
    }

    if (isPlainObject(valA) && isPlainObject(valB)) {
      const generic = mergeGenericJson(valA, valB, `vite.${key}`);
      merged[key] = generic.merged;
      conflicts.push(...generic.conflicts);
      continue;
    }

    if (Array.isArray(valA) && Array.isArray(valB)) {
      // Generic array union
      const union = unionArrays(valA as unknown[], valB as unknown[]);
      merged[key] = union;
      continue;
    }

    conflicts.push({
      type: 'config',
      package: `vite.${key}`,
      values: { 'repo-a': String(valA), 'repo-b': String(valB) },
      severity: 'warning',
    });
    // Keep first side
    merged[key] = valA;
  }

  return { merged, conflicts };
}

// ---------------------------------------------------------------------------
// eslint config
// ---------------------------------------------------------------------------

export function mergeEslintConfig(a: unknown, b: unknown): ConfigMergeResult {
  const conflicts: Conflict[] = [];

  const objA = isPlainObject(a) ? (a as Record<string, unknown>) : {};
  const objB = isPlainObject(b) ? (b as Record<string, unknown>) : {};

  const merged: Record<string, unknown> = { ...objA };

  for (const [key, valB] of Object.entries(objB)) {
    const valA = objA[key];
    if (!(key in objA)) {
      merged[key] = valB;
      continue;
    }
    if (JSON.stringify(valA) === JSON.stringify(valB)) continue;

    if (key === 'plugins' || key === 'extends') {
      const arrA = asArray<unknown>(valA as unknown[] | string | undefined);
      const arrB = asArray<unknown>(valB as unknown[] | string | undefined);
      const union = unionArrays(arrA, arrB);
      // Preserve original shape if single string
      if (
        !Array.isArray(objA[key]) &&
        !Array.isArray(objB[key]) &&
        typeof valA === 'string' &&
        typeof valB === 'string'
      ) {
        merged[key] = union.length === 1 ? union[0] : union;
      } else {
        merged[key] = union;
      }
      continue;
    }

    if (key === 'rules' && isPlainObject(valA) && isPlainObject(valB)) {
      const rulesA = valA as Record<string, unknown>;
      const rulesB = valB as Record<string, unknown>;
      const rulesMerged: Record<string, unknown> = { ...rulesA };
      for (const [rule, valRuleB] of Object.entries(rulesB)) {
        const valRuleA = rulesA[rule];
        if (!(rule in rulesA)) {
          rulesMerged[rule] = valRuleB;
          continue;
        }
        if (JSON.stringify(valRuleA) === JSON.stringify(valRuleB)) continue;

        conflicts.push({
          type: 'config',
          package: `eslint.rules.${rule}`,
          values: { 'repo-a': JSON.stringify(valRuleA), 'repo-b': JSON.stringify(valRuleB) },
          severity: 'warning',
        });
        // Keep first side
        rulesMerged[rule] = valRuleA;
      }
      merged[key] = rulesMerged;
      continue;
    }

    if (isPlainObject(valA) && isPlainObject(valB)) {
      const generic = mergeGenericJson(valA, valB, `eslint.${key}`);
      merged[key] = generic.merged;
      conflicts.push(...generic.conflicts);
      continue;
    }

    if (Array.isArray(valA) && Array.isArray(valB)) {
      merged[key] = unionArrays(valA as unknown[], valB as unknown[]);
      continue;
    }

    conflicts.push({
      type: 'config',
      package: `eslint.${key}`,
      values: { 'repo-a': String(valA), 'repo-b': String(valB) },
      severity: 'warning',
    });
    merged[key] = valA;
  }

  return { merged, conflicts };
}
