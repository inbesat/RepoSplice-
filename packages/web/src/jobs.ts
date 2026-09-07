import {
  QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

/**
 * ScaffoldJob: placeholder row shape for the jobs query. P-224 replaces
 * this with `JobSummary` (`{id, kind, status, ...}`, api/jobs.ts) — the
 * query plumbing below (keys, client, hooks) stays as-is.
 */
export type ScaffoldJob = {
  id: string;
  label: string;
};

export type FetchJobs = () => Promise<ScaffoldJob[]>;

/** Query keys for job history (P-224 extends this object, never renames `all`). */
export const jobKeys = {
  all: ['jobs'] as const,
};

/** P-297 hook point: replaced by the real GET /api/jobs client. Resolves empty so the UI renders before the backend exists. */
export const defaultFetchJobs: FetchJobs = async () => [];

/**
 * createQueryClient: fresh client per owner (one for App root, one per
 * test). `retry: false` keeps failures fast and deterministic;
 * `staleTime` of 60s makes remounts read cache (P-224 tunes both).
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 60_000 },
    },
  });
}

/** useJobs: job-history list query (P-224 feeds it the real fetcher). */
export function useJobs(
  fetchJobs: FetchJobs = defaultFetchJobs
): UseQueryResult<ScaffoldJob[], Error> {
  return useQuery({ queryKey: jobKeys.all, queryFn: fetchJobs });
}

/**
 * useRefreshJobs: refresh-button mutation. Invalidation marks the jobs
 * query stale so active views refetch; the mutation itself resolves once
 * invalidation is dispatched, giving the button pending/error states.
 */
export function useRefreshJobs(): UseMutationResult<void, Error, void> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await client.invalidateQueries({ queryKey: jobKeys.all });
    },
  });
}
