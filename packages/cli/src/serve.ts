import { Elysia } from 'elysia';
import { STITCH_VERSION } from './program.js';

/** JSON body of GET /health. */
export type HealthBody = {
  ok: true;
  service: 'stitch';
  version: string;
};

/**
 * createApp: the `stitch serve` HTTP/WS app (P-193 owner). `/health` serves
 * readiness (used by deploy/canary checks); `/ws` echo is the hook where
 * the P-241 event stream attaches. Pure builder — `stitch serve` calls
 * `.listen(port)` on the Bun runtime; tests drive the same route table
 * through `app.handle` (adapter-independent), since Elysia's WebStandard
 * adapter under vitest/Node does not support `.listen()`.
 */
export function createApp() {
  // No explicit return type: Elysia's chained-builder generics are not
  // assignable to a bare `Elysia` annotation under exactOptionalPropertyTypes.
  // Consumers name it via `ReturnType<typeof createApp>`.
  return new Elysia()
    .get('/health', (): HealthBody => ({ ok: true, service: 'stitch', version: STITCH_VERSION }))
    .ws('/ws', {
      message(ws, message) {
        ws.send(message);
      },
    });
}
