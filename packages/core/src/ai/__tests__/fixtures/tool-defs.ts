// P-147 shared tool fixtures.
//
// Two fake tools that touch only in-memory state, so the whole AI stack can be
// exercised end to end with zero filesystem and zero network. These mirror the
// tool contracts P-148+ will implement for real, so the suite stays the
// regression net when the real tools land.
import { ok, type Result } from 'neverthrow';
import { z } from 'zod';
import type { ToolDefinition } from '../../types.js';

/** In-memory repo the fixtures read from and patch. */
export interface FakeRepo {
  files: Record<string, string>;
  /** Ordered log of every mutation, so tests can assert ordering. */
  patches: { path: string; content: string }[];
}

export function createFakeRepo(initial: Record<string, string> = {}): FakeRepo {
  return { files: { ...initial }, patches: [] };
}

/** Reads a file from the in-memory repo. */
export const readFileTool = (repo: FakeRepo): ToolDefinition => ({
  name: 'read_file',
  description: 'Read a file from the working repo',
  schema: { path: z.string().min(1) },
  execute: async (args): Promise<Result<unknown, never>> => {
    const { path } = args as { path: string };
    const content = repo.files[path];
    if (content === undefined) {
      return ok({ path, found: false });
    }
    return ok({ path, found: true, content });
  },
  autonomy: 'auto',
});

/** Writes a file into the in-memory repo, recording the patch order. */
export const applyPatchTool = (repo: FakeRepo): ToolDefinition => ({
  name: 'apply_patch',
  description: 'Replace a file in the working repo',
  schema: { path: z.string().min(1), content: z.string() },
  execute: async (args): Promise<Result<unknown, never>> => {
    const { path, content } = args as { path: string; content: string };
    repo.files[path] = content;
    repo.patches.push({ path, content });
    return ok({ path, bytes: content.length });
  },
  autonomy: 'auto',
});

/**
 * A gated tool. The loop consults `LoopConfig.approvalGate` before running it,
 * so this fixture only needs to mark itself `gated`.
 */
export const gatedTool: ToolDefinition = {
  name: 'ask_user',
  description: 'Requires human approval before running',
  schema: { question: z.string() },
  execute: async (): Promise<Result<unknown, never>> => ok('approved'),
  autonomy: 'gated',
};

/** The two standard fixtures, bound to one repo. */
export function toolDefs(repo: FakeRepo): ToolDefinition[] {
  return [readFileTool(repo), applyPatchTool(repo)];
}
