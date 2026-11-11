import { test as tt } from 'node:test';
import { strict as as } from 'node:assert';
import { once as on } from 'node:events';
import { MockLanguageModelV4 as mk } from 'ai/test';
import { simulateReadableStream as rs } from 'ai';
import { mm } from '../src/memory.js';
import { ws } from '../src/search.js';
import { ax } from '../src/agent.js';
import { sv } from '../src/server.js';
const us = { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 3, text: 3, reasoning: 0 } };
const fn = v => ({ type: 'finish', finishReason: { unified: v, raw: v }, usage: us });
const ts = tx => [{ type: 'text-start', id: 'a' }, { type: 'text-delta', id: 'a', delta: tx }, { type: 'text-end', id: 'a' }, fn('stop')];
const sr = cs => ({ stream: rs({ chunks: cs, initialDelayInMs: 0, chunkDelayInMs: 0 }) });
const fe = async () => Response.json({ results: [{ title: 'Evidence', url: 'https://example.com/a', content: 'Supported fact.' }] });
tt('timestamps, sequence, isolation, and atomic session leases', () => {
  let n = 1000;
  const m = mm(() => n);
  const s = m.cr('Asia/Calcutta');
  const b = m.cr();
  m.ac(s.sessionId, 'Yesterday');
  as.throws(() => m.ac(s.sessionId, 'Race'), { code: 'sessionBusy' });
  n += 37;
  m.cm(s, 'Answer', 'complete');
  as.equal(s.messageHistory[0].timestamp, '1970-01-01T00:00:01.000Z');
  as.equal(s.messageHistory[1].timestamp, '1970-01-01T00:00:01.037Z');
  as.deepEqual(s.messageHistory.map(v => v.sequence), [1, 2]);
  as.equal(b.messageHistory.length, 0);
  as.equal(s.busy, false);
});
tt('expiry never evicts active work and capacity is bounded', () => {
  let n = 0;
  const m = mm(() => n, 1, 100);
  const s = m.cr();
  m.ac(s.sessionId, 'Hello');
  n = 101;
  as.throws(() => m.cr(), { code: 'sessionCapacity' });
  m.cm(s, 'Hello', 'complete');
  n = 202;
  m.gc();
  as.throws(() => m.ac(s.sessionId, 'Again'), { code: 'sessionMissing' });
  as.ok(m.cr().sessionId);
});
tt('input byte limits and history limits reject without locking', () => {
  const m = mm();
  const s = m.cr();
  as.throws(() => m.ac(s.sessionId, '🙂'.repeat(1600)), { code: 'messageTooLarge' });
  as.equal(s.busy, false);
  for (let i = 0; i < 32; i++) {
    m.ac(s.sessionId, 'a');
    m.cm(s, 'b', 'complete');
  }
  as.throws(() => m.ac(s.sessionId, 'c'), { code: 'sessionFull' });
  as.equal(s.messageHistory.length, 64);
});
tt('search cache is exact, freshness-aware, and session-local', async () => {
  const s = mm().cr();
  const sg = new AbortController().signal;
  let n = 0;
  const f = async () => { n++; return fe(); };
  const em = async () => {};
  const a = await ws('k', s, sg, em, f).execute({ queries: ['Test'], fresh: false }, {});
  const b = await ws('k', s, sg, em, f).execute({ queries: ['Test'], fresh: false }, {});
  as.equal(n, 1);
  as.equal(b.searches[0].cached, true);
  as.equal(a.searches[0].retrievedAt, b.searches[0].retrievedAt);
  await ws('k', s, sg, em, f).execute({ queries: ['Test'], fresh: true }, {});
  await ws('k', mm().cr(), sg, em, f).execute({ queries: ['Test'], fresh: false }, {});
  as.equal(n, 3);
  s.cache.get('Test').time = 0;
  await ws('k', s, sg, em, f).execute({ queries: ['Test'], fresh: false }, {});
  as.equal(n, 4);
});
tt('searches fan out concurrently and failed evidence is not cached', async () => {
  const s = mm().cr();
  const sg = new AbortController().signal;
  let n = 0;
  let go;
  const gt = new Promise(r => { go = r; });
  const f = async (u, o) => {
    if (++n === 3) go();
    await gt;
    return JSON.parse(o.body).query === 'bad' ? new Response('', { status: 503 }) : fe();
  };
  const t = ws('k', s, sg, async () => {}, f);
  const r = await t.execute({ queries: ['one', 'two', 'bad'], fresh: true }, {});
  as.equal(n, 3);
  as.equal(r.searches[2].error, 'searchUnavailable');
  as.equal(s.cache.has('bad'), false);
  as.equal((await t.execute({ queries: ['again'], fresh: true }, {})).error, 'searchBudgetExceeded');
});
tt('search propagates cancellation rather than fabricating unavailable evidence', async () => {
  const a = new AbortController();
  a.abort(new Error('cancelled'));
  const t = ws('k', mm().cr(), a.signal, async () => {}, async () => { throw new Error('aborted'); });
  await as.rejects(t.execute({ queries: ['x'], fresh: true }, {}), /cancelled/);
});
tt('agent registers exactly one tool and injects trusted temporal metadata', async () => {
  const m = mm();
  const s = m.cr('Asia/Calcutta');
  m.ac(s.sessionId, 'Remember yesterday');
  const md = new mk({ doStream: sr(ts('Hello')) });
  const ev = [];
  const sg = new AbortController().signal;
  const em = async (k, v) => { ev.push([k, v]); };
  as.equal(await ax(s, md, ws('k', s, sg, em, fe), sg, em, 'auto'), 'Hello');
  const c = md.doStreamCalls[0];
  as.deepEqual(c.tools.map(v => v.name), ['webSearch']);
  as.ok(c.prompt[0].content.includes(s.messageHistory[0].timestamp));
  as.ok(c.prompt[0].content.includes('Asia/Calcutta'));
  as.equal(ev[0][0], 'text');
});
tt('grounded execution searches then synthesizes with tools disabled', async () => {
  const m = mm();
  const s = m.cr();
  m.ac(s.sessionId, 'Find a fact');
  const md = new mk({ doStream: [sr([{ type: 'tool-call', toolCallId: 't', toolName: 'webSearch', input: JSON.stringify({ queries: ['fact'], fresh: true }) }, fn('tool-calls')]), sr(ts('Fact [source](https://example.com/a).'))] });
  const sg = new AbortController().signal;
  const ev = [];
  const em = async (k, v) => { ev.push([k, v]); };
  await ax(s, md, ws('k', s, sg, em, fe), sg, em);
  as.equal(md.doStreamCalls.length, 2);
  as.equal(md.doStreamCalls[0].toolChoice.type, 'required');
  as.equal(md.doStreamCalls[1].toolChoice.type, 'none');
  as.equal(ev[0][0], 'sources');
  as.equal(s.output, 'Fact [source](https://example.com/a).');
});
tt('provider errors preserve partial output and do not produce success', async () => {
  const m = mm();
  const s = m.cr();
  m.ac(s.sessionId, 'Hello');
  const md = new mk({ doStream: sr([{ type: 'text-start', id: 'a' }, { type: 'text-delta', id: 'a', delta: 'Partial' }, { type: 'error', error: new Error('provider secret') }]) });
  const sg = new AbortController().signal;
  await as.rejects(ax(s, md, ws('k', s, sg, async () => {}, fe), sg, async () => {}, 'auto'), { code: 'generationFailed' });
  as.equal(s.output, 'Partial');
});
tt('agent cancellation terminates an idle provider stream', async () => {
  const m = mm();
  const s = m.cr();
  m.ac(s.sessionId, 'Hello');
  const a = new AbortController();
  const md = new mk({ doStream: () => {
    queueMicrotask(() => a.abort(new Error('cancelled')));
    return { stream: new ReadableStream({ start: c => { c.enqueue({ type: 'stream-start', warnings: [] }); } }) };
  } });
  await as.rejects(ax(s, md, ws('k', s, a.signal, async () => {}, fe), a.signal, async () => {}, 'auto'));
});
tt('truncated generation is explicitly incomplete', async () => {
  const m = mm();
  const s = m.cr();
  m.ac(s.sessionId, 'Hello');
  const cs = ts('Partial');
  cs[cs.length - 1] = fn('length');
  const md = new mk({ doStream: sr(cs) });
  const sg = new AbortController().signal;
  await as.rejects(ax(s, md, ws('k', s, sg, async () => {}, fe), sg, async () => {}, 'auto'), { code: 'incompleteGeneration' });
});
tt('HTTP authentication, validation, SSE, and cross-turn memory', async t => {
  const md = new mk({ doStream: () => sr(ts('Hello')) });
  const s = sv({ AppKey: 'a'.repeat(24), TavilyKey: 'test' }, md, fe);
  const h = s.ap.listen(0, '127.0.0.1');
  await on(h, 'listening');
  t.after(async () => { s.close(); h.closeAllConnections(); await new Promise(r => h.close(r)); });
  const u = `http://127.0.0.1:${h.address().port}`;
  const hd = { Authorization: `Bearer ${'a'.repeat(24)}`, 'Content-Type': 'application/json' };
  as.equal((await fetch(`${u}/sessions`, { method: 'POST' })).status, 401);
  as.equal((await fetch(`${u}/sessions`, { method: 'POST', headers: hd, body: '{' })).status, 400);
  as.equal((await fetch(`${u}/sessions`, { method: 'POST', headers: hd, body: JSON.stringify({ timeZone: 'Invalid/Zone' }) })).status, 400);
  const r = await fetch(`${u}/sessions`, { method: 'POST', headers: hd, body: '{}' });
  as.equal(r.status, 201);
  const d = await r.json();
  for (const tx of ['First turn', 'Second turn']) {
    const p = await fetch(`${u}/chat`, { method: 'POST', headers: hd, body: JSON.stringify({ sessionId: d.sessionId, message: tx, mode: 'auto' }) });
    as.equal(p.status, 200);
    as.match(p.headers.get('content-type'), /text\/event-stream/);
    const v = await p.text();
    as.match(v, /event: text/);
    as.match(v, /event: done/);
    as.doesNotMatch(v, /event: error/);
  }
  const ps = md.doStreamCalls[1].prompt;
  as.equal(ps.filter(v => v.role === 'user').length, 2);
  as.ok(JSON.stringify(ps).includes('First turn'));
});
tt('HTTP failure emits safe error, records partial history, and releases lease', async t => {
  let n = 0;
  const md = new mk({ doStream: () => ++n === 1 ? sr([{ type: 'text-start', id: 'a' }, { type: 'text-delta', id: 'a', delta: 'Partial' }, { type: 'error', error: new Error('secret') }]) : sr(ts('Recovered')) });
  const s = sv({ AppKey: 'a'.repeat(24), TavilyKey: 'test' }, md, fe);
  const h = s.ap.listen(0, '127.0.0.1');
  await on(h, 'listening');
  t.after(async () => { s.close(); h.closeAllConnections(); await new Promise(r => h.close(r)); });
  const u = `http://127.0.0.1:${h.address().port}`;
  const hd = { Authorization: `Bearer ${'a'.repeat(24)}`, 'Content-Type': 'application/json' };
  const d = await (await fetch(`${u}/sessions`, { method: 'POST', headers: hd, body: '{}' })).json();
  const bo = JSON.stringify({ sessionId: d.sessionId, message: 'Hello', mode: 'auto' });
  const r = await (await fetch(`${u}/chat`, { method: 'POST', headers: hd, body: bo })).text();
  as.match(r, /event: error/);
  as.doesNotMatch(r, /event: done|secret/);
  const v = await (await fetch(`${u}/chat`, { method: 'POST', headers: hd, body: bo })).text();
  as.match(v, /event: done/);
  as.ok(JSON.stringify(md.doStreamCalls[1].prompt).includes('Partial'));
  as.ok(md.doStreamCalls[1].prompt[0].content.includes('failed'));
});
tt('disconnect aborts active work and overlapping turns return 409', async t => {
  let n = 0;
  let go;
  const gt = new Promise(r => { go = r; });
  const md = new mk({ doStream: () => {
    if (++n > 1) return sr(ts('Recovered'));
    go();
    return { stream: new ReadableStream({ start: c => { c.enqueue({ type: 'stream-start', warnings: [] }); } }) };
  } });
  const s = sv({ AppKey: 'a'.repeat(24), TavilyKey: 'test' }, md, fe);
  const h = s.ap.listen(0, '127.0.0.1');
  await on(h, 'listening');
  t.after(async () => { s.close(); h.closeAllConnections(); await new Promise(r => h.close(r)); });
  const u = `http://127.0.0.1:${h.address().port}`;
  const hd = { Authorization: `Bearer ${'a'.repeat(24)}`, 'Content-Type': 'application/json' };
  const d = await (await fetch(`${u}/sessions`, { method: 'POST', headers: hd, body: '{}' })).json();
  const bo = JSON.stringify({ sessionId: d.sessionId, message: 'Hello', mode: 'auto' });
  const a = new AbortController();
  const r = await fetch(`${u}/chat`, { method: 'POST', headers: hd, body: bo, signal: a.signal });
  await gt;
  as.equal((await fetch(`${u}/chat`, { method: 'POST', headers: hd, body: bo })).status, 409);
  a.abort();
  await as.rejects(r.text());
  let p;
  for (let i = 0; i < 20; i++) {
    p = await fetch(`${u}/chat`, { method: 'POST', headers: hd, body: bo });
    if (p.status !== 409) break;
    await p.text();
  }
  as.equal(p.status, 200);
  as.match(await p.text(), /event: done/);
  as.ok(md.doStreamCalls[1].prompt[0].content.includes('interrupted'));
});
