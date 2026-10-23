// Prompt Templates (P-141).
//
// Centralized, versioned prompt templates with strict variable substitution.
// Templates are plain markdown files loaded at build time.

import { createHash } from 'node:crypto';
import { ok, err, type Result } from 'neverthrow';
import { type StitchError } from '../result/index.js';
import systemTemplate from './prompts/system.md?raw';
import resolveDepsTemplate from './prompts/resolve-deps.md?raw';
import generateComponentTemplate from './prompts/generate-component.md?raw';
import detectGapsTemplate from './prompts/detect-gaps.md?raw';
// P-347 names this template `.txt` (the rest of the set is `.md`); the raw
// loader treats them the same, and the spec's path is the mandate.
import selfCritiqueTemplate from './prompts/self-critique.txt?raw';

const TEMPLATES: Record<string, string> = {
  system: systemTemplate,
  'resolve-deps': resolveDepsTemplate,
  'generate-component': generateComponentTemplate,
  'detect-gaps': detectGapsTemplate,
  'self-critique': selfCritiqueTemplate,
};

let cachedPromptVersion: string | undefined;

/**
 * Content hash of the template set — the `promptVersion` the P-145 audit log
 * records. Derived from the template bytes so editing any template changes the
 * recorded version without anyone having to bump a constant.
 *
 * @param name - Optional single template name; omit for the whole set
 */
export function promptVersion(name?: string): string {
  if (name === undefined) {
    if (cachedPromptVersion === undefined) {
      const hash = createHash('sha256');
      for (const key of Object.keys(TEMPLATES).sort()) {
        hash
          .update(key)
          .update('\u0000')
          .update(TEMPLATES[key] ?? '')
          .update('\u0000');
      }
      cachedPromptVersion = hash.digest('hex').slice(0, 12);
    }
    return cachedPromptVersion;
  }
  const template = TEMPLATES[name];
  if (template === undefined) return 'unknown';
  return createHash('sha256').update(template).digest('hex').slice(0, 12);
}

/**
 * Render a template by name with variable substitution.
 * @param name - Template name (key in TEMPLATES)
 * @param vars - Variable values to substitute for {{key}} placeholders
 * @returns Result with the rendered string, or PROMPT_NOT_FOUND /
 *   PROMPT_MISSING_VAR (P-141) when the template or a placeholder value
 *   is missing
 */
export function render(
  name: string,
  vars: Record<string, string | number> = {}
): Result<string, StitchError> {
  const template = TEMPLATES[name];
  if (!template) {
    return err({ code: 'PROMPT_NOT_FOUND', message: `Template not found: ${name}` });
  }

  // Find all {{placeholder}} references
  const placeholderRegex = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  const matches = [...template.matchAll(placeholderRegex)];

  for (const match of matches) {
    const key = match[1] ?? '';
    if (!(key in vars)) {
      return err({
        code: 'PROMPT_MISSING_VAR',
        message: `Missing variable for placeholder: ${key}`,
      });
    }
  }

  // Substitute all placeholders
  let rendered = template;
  for (const [key, value] of Object.entries(vars)) {
    const regex = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g');
    rendered = rendered.replace(regex, String(value));
  }

  return ok(rendered);
}

/** Build system prompt with config. */
export function systemPrompt(config: Record<string, string | number> = {}): string {
  return render('system', config)._unsafeUnwrap();
}

/** Build resolve-deps prompt pair. */
export function resolveDepsPrompt(manifestSummary: string): { system: string; user: string } {
  return {
    system: systemPrompt(),
    user: render('resolve-deps', { manifestSummary })._unsafeUnwrap(),
  };
}

/** Build generate-component prompt pair. */
export function generateComponentPrompt(spec: string): { system: string; user: string } {
  return {
    system: systemPrompt(),
    user: render('generate-component', { spec })._unsafeUnwrap(),
  };
}

/** Build detect-gaps prompt pair. */
export function detectGapsPrompt(treeSummary: string): { system: string; user: string } {
  return {
    system: systemPrompt(),
    user: render('detect-gaps', { treeSummary })._unsafeUnwrap(),
  };
}

/** Build the self-critique prompt pair (P-347): the agent re-reads its own diff. */
export function selfCritiquePrompt(
  diff: string,
  context: string
): { system: string; user: string } {
  return {
    system: systemPrompt(),
    user: render('self-critique', { diff, context })._unsafeUnwrap(),
  };
}
