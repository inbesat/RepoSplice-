// P-335 — a protocol-faithful STUB language server for the LSP client tests.
// It speaks the real framing (Content-Length + \r\n\r\n + a JSON body) and
// answers the handful of methods the client exercises. A real server is used
// for the mandated tests (the harness prefers typescript-language-server);
// this stub keeps the unit tests hermetic and deterministic.

let buffer = Buffer.alloc(0);

function send(payload: unknown): void {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}

function notify(method: string, params: unknown): void {
  send({ jsonrpc: '2.0', method, params });
}

function handle(message: { id?: number; method?: string; params?: unknown }): void {
  const method = message.method ?? '';
  const id = message.id;
  switch (method) {
    case 'initialize':
      send({
        jsonrpc: '2.0',
        id,
        result: {
          capabilities: { definitionProvider: true, textDocumentSync: 1 },
          serverInfo: { name: 'stitch-lsp-stub', version: '1.0.0' },
        },
      });
      // The notification registry case: a log line right after initialize.
      notify('window/logMessage', { type: 3, message: 'stub server ready' });
      return;
    case 'textDocument/definition':
      send({
        jsonrpc: '2.0',
        id,
        result: {
          uri: 'file:///stub/definition.ts',
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        },
      });
      return;
    case 'echo':
      send({
        jsonrpc: '2.0',
        id,
        result: { echo: (message.params as { value?: unknown } | undefined)?.value ?? null },
      });
      return;
    case 'slow':
      // Deliberately no answer: the client must time the request out.
      return;
    case 'unknownId':
      // A response for an id the client never sent: it must be ignored.
      send({ jsonrpc: '2.0', id: 9999, result: { stray: true } });
      return;
    case 'shutdown':
      send({ jsonrpc: '2.0', id, result: null });
      return;
    case 'exit':
      process.exit(0);
      return;
    default:
      if (id !== undefined) {
        send({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `the stub does not implement ${method}` },
        });
      }
  }
}

process.stdin.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk as Buffer]);
  for (;;) {
    const separator = buffer.indexOf('\r\n\r\n');
    if (separator === -1) return;
    const header = buffer.subarray(0, separator).toString('utf8');
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (match === null) {
      // A malformed header: drop the buffer instead of throwing.
      buffer = Buffer.alloc(0);
      return;
    }
    const length = Number.parseInt(match[1] ?? '0', 10);
    const start = separator + 4;
    if (buffer.length < start + length) return;
    const body = buffer.subarray(start, start + length).toString('utf8');
    buffer = buffer.subarray(start + length);
    try {
      handle(JSON.parse(body) as { id?: number; method?: string; params?: unknown });
    } catch {
      // A malformed body is ignored.
    }
  }
});

process.stdin.resume();
