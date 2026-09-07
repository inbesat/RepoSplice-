import { describe, it, expect } from 'vitest';
import { createApp } from './serve.js';

describe('serve scaffold (P-043 elysia)', () => {
  it('serves health', async () => {
    // NOTE (P-043): under vitest's Node runtime Elysia uses its WebStandard
    // adapter, where `.listen()` throws ("export default Elysia.fetch").
    // Sockets are a Bun-runtime path exercised by `stitch serve` (P-193);
    // here we drive the same route table through `app.handle`, which is
    // adapter-independent.
    const app = createApp();
    const res = await app.handle(new Request('http://localhost/health'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ ok: true, service: 'stitch' });
  }, 15000);
});
