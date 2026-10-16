// P-241 — event bus tests.
//
// The bus is pure plus an injected clock, so ordering, wildcards, unsubscribe and
// async handlers all run with no server anywhere. The WS-forward test drives the
// CORE forwarder against a FAKE sink rather than a real WebSocket: the bridge is
// logic over an injected sink precisely so its backpressure behaviour is testable,
// and the CLI's adapter is then a handful of lines (ADR-065).
//
// The five required scenarios from the phase spec:
//
//   it('order')     it('wildcard')     it('unsubscribe')
//   it('async handler')                it('ws forward backpressure')

import { describe, it, expect } from 'vitest';
import {
  COALESCIBLE_TOPICS,
  TOPICS,
  eventEnvelopeSchema,
  matchesTopic,
  topicsFor,
  type Topic,
} from '../topics.js';
import { Bus, createBusForwarder, type EventSink } from '../bus.js';

const T1 = '2026-10-16T00:00:00.000Z';

/** A fresh bus with a fixed clock. */
function makeBus(): Bus {
  return new Bus({ now: () => T1 });
}

/** A sink that always accepts, recording what it was given. */
function acceptingSink(topics: string[] = []): {
  sink: EventSink;
  sent: { topic: string; payload: unknown; ts: string }[];
} {
  const sent: { topic: string; payload: unknown; ts: string }[] = [];
  return {
    sent,
    sink: {
      send: event => {
        sent.push(event);
        return true;
      },
      topics: () => topics,
    },
  };
}

describe('P-241 event bus', () => {
  it('order', () => {
    const bus = makeBus();
    const seen: { topic: string; sequence: number }[] = [];
    bus.subscribe('pipeline.stage', (_p, envelope) =>
      seen.push({ topic: envelope.topic, sequence: envelope.sequence })
    );

    // Sequence is stamped PER TOPIC by the bus, so two publishers cannot disagree
    // about order and a subscriber can assert it.
    bus.publish('pipeline.stage', { stage: 'config', from: 'pending', to: 'running' });
    bus.publish('pipeline.stage', { stage: 'config', from: 'running', to: 'passed' });
    bus.publish('pipeline.stage', { stage: 'sources', from: 'pending', to: 'running' });

    expect(seen.map(s => s.sequence)).toEqual([1, 2, 3]);
    expect(seen.every(s => s.topic === 'pipeline.stage')).toBe(true);

    // Delivery is SYNCHRONOUS: the envelope comes back from publish, already stamped.
    const envelope = bus.publish('pipeline.stage', {
      stage: 'sources',
      from: 'running',
      to: 'passed',
    });
    expect(envelope.ts).toBe(T1);
    expect(envelope.sequence).toBe(4);
    expect(seen).toHaveLength(4);

    // Two subscribers see the SAME order, and registration order is delivery order.
    const order: string[] = [];
    const second = makeBus();
    second.subscribe('job.created', () => order.push('first'));
    second.subscribe('job.created', () => order.push('second'));
    second.publish('job.created', { jobId: 'j1', kind: 'stitch' });
    expect(order).toEqual(['first', 'second']);

    // Sequence counters are per topic.
    const counts = second.sequenceCounts();
    expect(counts['job.created']).toBe(1);

    // The envelope schema is the wire contract and validates a real envelope.
    expect(
      eventEnvelopeSchema.safeParse({ topic: 'progress', ts: T1, payload: { stage: 'deps' } })
        .success
    ).toBe(true);
    expect(eventEnvelopeSchema.safeParse({ topic: '', ts: T1, payload: {} }).success).toBe(false);
    expect(eventEnvelopeSchema.safeParse({ topic: 'x', payload: {} }).success).toBe(false);
  });

  it('wildcard', () => {
    // One level only: `job.*` covers the job topics, never `pipeline.stage`.
    expect(matchesTopic('job.*', 'job.created')).toBe(true);
    expect(matchesTopic('job.*', 'job.succeeded')).toBe(true);
    expect(matchesTopic('job.*', 'pipeline.stage')).toBe(false);
    expect(matchesTopic('pipeline.stage', 'pipeline.stage')).toBe(true);
    expect(matchesTopic('pipeline.stage', 'progress')).toBe(false);
    // No `**`, no mid-string star.
    expect(matchesTopic('*.stage', 'pipeline.stage')).toBe(false);
    expect(matchesTopic('job', 'job.created')).toBe(false);

    expect(topicsFor('job.*')).toEqual([
      'job.created',
      'job.started',
      'job.updated',
      'job.resumed',
      'job.cancelled',
      'job.failed',
      'job.succeeded',
    ]);
    expect(topicsFor('progress')).toEqual(['progress']);

    // A wildcard subscriber hears every job event and nothing else.
    const bus = makeBus();
    const heard: Topic[] = [];
    bus.subscribe('job.*', (_p, envelope) => heard.push(envelope.topic));
    bus.publish('job.created', { jobId: 'j1', kind: 'stitch' });
    bus.publish('job.started', { jobId: 'j1', kind: 'stitch' });
    bus.publish('pipeline.stage', { stage: 'config', from: 'pending', to: 'running' });
    bus.publish('job.succeeded', { jobId: 'j1', kind: 'stitch' });
    expect(heard).toEqual(['job.created', 'job.started', 'job.succeeded']);

    // `once` fires exactly once.
    const onceSeen: number[] = [];
    bus.once<(typeof TOPICS)[number]>('job.created', () => onceSeen.push(1));
    bus.publish('job.created', { jobId: 'j2', kind: 'stitch' });
    bus.publish('job.created', { jobId: 'j3', kind: 'stitch' });
    expect(onceSeen).toHaveLength(1);

    // The topic list is the stable contract, and coalescible topics are a subset.
    expect(TOPICS).toHaveLength(14);
    for (const topic of COALESCIBLE_TOPICS) expect(TOPICS).toContain(topic);
  });

  it('unsubscribe', () => {
    const bus = makeBus();
    const seen: string[] = [];
    const off = bus.subscribe('progress', payload =>
      seen.push(String((payload as { stage: string }).stage))
    );

    bus.publish('progress', { stage: 'a' });
    expect(seen).toEqual(['a']);
    expect(bus.size).toBe(1);

    off();
    expect(bus.size).toBe(0);
    bus.publish('progress', { stage: 'b' });
    // Removed for real: nothing new arrived.
    expect(seen).toEqual(['a']);

    // Unsubscribing twice is idempotent, so a cleanup path that runs twice cannot
    // remove someone else's later subscription.
    const later: string[] = [];
    const offLate = bus.subscribe('progress', payload =>
      later.push(String((payload as { stage: string }).stage))
    );
    off();
    bus.publish('progress', { stage: 'c' });
    expect(later).toEqual(['c']);
    expect(bus.size).toBe(1);
    offLate();

    // Removing ONE of two subscriptions leaves the other live.
    const a: number[] = [];
    const b: number[] = [];
    const offA = bus.subscribe('deps.merged', () => a.push(1));
    bus.subscribe('deps.merged', () => b.push(1));
    bus.publish('deps.merged', {});
    offA();
    bus.publish('deps.merged', {});
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(2);

    bus.clear();
    expect(bus.size).toBe(0);
  });

  it('async handler', async () => {
    const bus = makeBus();
    const failures: string[] = [];
    const slow = new Bus({ now: () => T1, onHandlerError: f => failures.push(f.message) });
    void bus;

    // An async handler is ALLOWED, but the bus does not await it — a slow
    // subscriber must never sit on the publisher's critical path (which is a
    // pipeline stage).
    const done: string[] = [];
    slow.subscribe('sandbox.run', async payload => {
      await Promise.resolve();
      done.push(String((payload as { id?: string }).id ?? 'x'));
    });
    const envelope = slow.publish('sandbox.run', { id: 'run-1' });
    expect(envelope.sequence).toBe(1);
    // Not awaited: the sync continuation has not run yet...
    expect(done).toEqual([]);
    // ...but it does run, once the microtask queue drains.
    await Promise.resolve();
    await Promise.resolve();
    expect(done).toEqual(['run-1']);

    // A THROWING handler does not break the bus: the other subscribers still get
    // the event, and the failure is reported rather than propagated.
    const before: string[] = [];
    const after: string[] = [];
    slow.subscribe('agent.tool', () => {
      throw new Error('subscriber exploded');
    });
    slow.subscribe('agent.tool', () => after.push('after'));
    expect(() => slow.publish('agent.tool', { tool: 'run_build' })).not.toThrow();
    expect(after).toEqual(['after']);
    expect(failures).toContain('subscriber exploded');
    void before;

    // A REJECTING async handler is reported the same way.
    const rejected = new Bus({ now: () => T1, onHandlerError: f => failures.push(f.message) });
    rejected.subscribe('license.verdict', async () => {
      throw new Error('async subscription failed');
    });
    expect(() => rejected.publish('license.verdict', {})).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(failures).toContain('async subscription failed');
  });

  it('ws forward backpressure', () => {
    // A sink that refuses everything after the first event — a slow client.
    const sent: { topic: string; payload: unknown; ts: string }[] = [];
    let full = false;
    const slowSink: EventSink = {
      send: event => {
        if (full) return false;
        sent.push(event);
        return true;
      },
      topics: () => [],
    };

    const bus = makeBus();
    const forwarder = createBusForwarder(bus, slowSink, { bufferLimit: 3 });

    bus.publish('pipeline.stage', { stage: 'config', from: 'pending', to: 'running' });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({
      topic: 'pipeline.stage',
      payload: { stage: 'config', from: 'pending', to: 'running' },
      ts: T1,
    });

    // The client stops draining. High-frequency progress ticks keep arriving; the
    // bus must NOT block, so they are coalesced — a progress bar wants the LATEST
    // position, never a missed intermediate one.
    full = true;
    for (let n = 1; n <= 5; n += 1) bus.publish('progress', { stage: 'deps', percent: n * 10 });
    const stats = forwarder.stats();
    expect(stats.coalesced).toBeGreaterThan(0);
    expect(stats.forwarded).toBe(1);

    // When the client drains, only the NEWEST progress value is delivered — proof
    // that coalescing kept the latest and dropped stale intermediates.
    full = false;
    forwarder.flush();
    const progress = sent.filter(event => event.topic === 'progress');
    expect(progress).toHaveLength(1);
    expect(progress[0]?.payload).toEqual({ stage: 'deps', percent: 50 });

    // An event that CANNOT be coalesced is dropped rather than allowed to block,
    // and the loss is counted so it is visible.
    full = true;
    for (let n = 0; n < 6; n += 1) bus.publish('job.created', { jobId: `j${n}`, kind: 'stitch' });
    const afterDrops = forwarder.stats();
    expect(afterDrops.dropped).toBeGreaterThan(0);
    full = false;
    forwarder.flush();

    // A client that declared topics (`hello`) receives ONLY those.
    const filtered = acceptingSink(['job.*']);
    const bus2 = makeBus();
    const scoped = createBusForwarder(bus2, filtered.sink);
    bus2.publish('job.created', { jobId: 'j9', kind: 'stitch' });
    bus2.publish('progress', { stage: 'deps' });
    bus2.publish('pipeline.stage', { stage: 'config', from: 'pending', to: 'running' });
    expect(filtered.sent.map(e => e.topic)).toEqual(['job.created']);

    // `close` detaches every subscription, so a closed client stops being fed.
    scoped.close();
    bus2.publish('job.created', { jobId: 'j10', kind: 'stitch' });
    expect(filtered.sent).toHaveLength(1);
    forwarder.close();
  });
});
