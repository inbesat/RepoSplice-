import { toast } from 'sonner';

/**
 * Messages for one promise-backed job toast. Each async job event
 * (P-241/P-247: merge completed, license verdict, sandbox pass/fail) gets a
 * loading line plus a success and an error line.
 */
export interface JobToastMessages {
  loading: string;
  success: string;
  error: string;
}

/**
 * notifyJob: show a loading toast for `promise`, then flip it to the success
 * or error message when the promise settles. Fire-and-forget void — sonner
 * owns the toast lifecycle and routes the rejection into the error toast, so
 * callers never observe an exception and no unhandled rejection escapes.
 * Pairs with `useMutation` (P-051): pass `mutation.mutateAsync(...)`.
 */
export function notifyJob<T>(promise: Promise<T>, messages: JobToastMessages): void {
  toast.promise(promise, {
    loading: messages.loading,
    success: messages.success,
    error: messages.error,
  });
}
