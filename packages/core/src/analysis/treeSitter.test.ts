// P-020 smoke test: confirms the tree-sitter loader and parse helpers
// work for every standard grammar (TS, TSX, JS, Python, Go, Rust).
// Each test parses a tiny snippet and asserts a known canonical node
// type is present in the tree (the spec's "a known node found" criterion).
import { describe, it, expect, beforeAll } from 'vitest';
import {
  initTreeSitter,
  parse,
  isSupportedLanguage,
  type SupportedLanguage,
} from './treeSitter.js';

beforeAll(async () => {
  await initTreeSitter();
}, 60_000);

describe('P-020 tree-sitter: language support', () => {
  it('isSupportedLanguage recognizes the 6 standard grammars', () => {
    expect(isSupportedLanguage('typescript')).toBe(true);
    expect(isSupportedLanguage('tsx')).toBe(true);
    expect(isSupportedLanguage('javascript')).toBe(true);
    expect(isSupportedLanguage('python')).toBe(true);
    expect(isSupportedLanguage('go')).toBe(true);
    expect(isSupportedLanguage('rust')).toBe(true);
    expect(isSupportedLanguage('ruby')).toBe(false);
    expect(isSupportedLanguage('kotlin')).toBe(false);
  });

  it('parse with an unsupported language returns a typed CONFIG_ERROR', async () => {
    const r = await parse('x = 1', 'ruby' as unknown as SupportedLanguage);
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error.code).toBe('CONFIG_ERROR');
      if (r.error.code === 'CONFIG_ERROR') {
        expect(r.error.field).toBe('language');
        expect(r.error.message).toContain('unsupported');
      }
    }
  });
});

describe('P-020 tree-sitter: per-language parsing', () => {
  it('parses TypeScript and finds an import_statement node', async () => {
    const src = `import { x } from './y';\nconst z: number = x + 1;\n`;
    const r = await parse(src, 'typescript');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      // Walk the tree and find at least one import_statement
      const found = findNodeByType(r.value.rootNode, 'import_statement');
      expect(found).toBeTruthy();
      // The function declaration is a bit too specific; just check the
      // root is a program node.
      expect(r.value.rootNode.type).toBe('program');
    }
  });

  it('parses TSX and finds a jsx_element node', async () => {
    const src = `export const App = () => <div className="x">hi</div>;\n`;
    const r = await parse(src, 'tsx');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      const found = findNodeByType(r.value.rootNode, 'jsx_element');
      expect(found).toBeTruthy();
    }
  });

  it('parses JavaScript and finds an import_statement node', async () => {
    const src = `import x from './y';\nconsole.log(x);\n`;
    const r = await parse(src, 'javascript');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      const found = findNodeByType(r.value.rootNode, 'import_statement');
      expect(found).toBeTruthy();
    }
  });

  it('parses Python and finds an import_statement node', async () => {
    const src = `import os\nfrom sys import argv\nprint(argv)\n`;
    const r = await parse(src, 'python');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      // tree-sitter-python's root is 'module'; imports are 'import_statement'
      // or 'import_from_statement'. Just check the tree parses to a module.
      expect(r.value.rootNode.type).toBe('module');
      const found = findNodeByType(r.value.rootNode, 'import_statement');
      expect(found).toBeTruthy();
    }
  });

  it('parses Go and finds an import_declaration node', async () => {
    const src = `package main\nimport "fmt"\nfunc main() { fmt.Println("hi") }\n`;
    const r = await parse(src, 'go');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.rootNode.type).toBe('source_file');
      const found = findNodeByType(r.value.rootNode, 'import_declaration');
      expect(found).toBeTruthy();
    }
  });

  it('parses Rust and finds a use_declaration node', async () => {
    const src = `use std::io;\nfn main() { println!("hi"); }\n`;
    const r = await parse(src, 'rust');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.rootNode.type).toBe('source_file');
      const found = findNodeByType(r.value.rootNode, 'use_declaration');
      expect(found).toBeTruthy();
    }
  });
});

// Walk the tree depth-first; return the first node whose `type` matches.
// Used by the per-language tests to assert a known node is present.
function findNodeByType(node: { type: string; children: unknown[] }, type: string): unknown {
  if (node.type === type) return node;
  for (const child of node.children as Array<{ type: string; children: unknown[] }>) {
    const found = findNodeByType(child, type);
    if (found) return found;
  }
  return null;
}
