import ex from 'express';
import { z } from 'zod';
import { createAnthropic as ca } from '@ai-sdk/anthropic';
import { timingSafeEqual as te, createHash as ch, randomUUID as ru } from 'node:crypto';
import { once as on } from 'node:events';
import { pathToFileURL as pu } from 'node:url';
import { mm, er } from './memory.js';
import { ws } from './search.js';
import { ax } from './agent.js';
export function sv(cf, md, fe = fetch) {
  const ap = ex();
  const ms = mm();
  const ac = new Set();
  const hs = v => ch('sha256').update(v).digest();
  const tz = z.string().max(100).refine(v => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: v });
      return true;
    } catch {
      return false;
    }
  });
  const tm = setInterval(ms.gc, 60000);
  tm.unref();
  ap.disable('x-powered-by');
  ap.use((q, r, nx) => {
    r.locals.id = ru();
    r.setHeader('X-Request-Id', r.locals.id);
    if (!te(hs(q.get('authorization') ?? ''), hs(`Bearer ${cf.AppKey}`))) return r.status(401).json({ error: 'unauthorized', requestId: r.locals.id });
    nx();
  });
  ap.use(ex.json({ limit: '12kb', strict: true }));
  ap.post('/sessions', (q, r) => {
    const d = z.object({ timeZone: tz.default('UTC') }).strict().parse(q.body ?? {});
    const s = ms.cr(d.timeZone);
    r.status(201).json({ sessionId: s.sessionId, timestamp: s.timestamp, timeZone: s.timeZone });
  });
  ap.post('/chat', async (q, r) => {
    const d = z.object({ sessionId: z.string().uuid(), message: z.string().trim().min(1).max(6000), mode: z.enum(['grounded', 'auto']).default('grounded') }).strict().parse(q.body);
    if (ac.size >= 32) throw er('serverBusy', 503);
    const s = ms.ac(d.sessionId, d.message);
    const a = new AbortController();
    const sg = a.signal;
    const at = performance.now();
    let ft = null;
    let st = 'failed';
    let cd = 'generationFailed';
    ac.add(a);
    const tm = setTimeout(() => a.abort(er('deadlineExceeded', 504)), 45000);
    const dc = () => { if (!r.writableEnded) a.abort(er('clientDisconnected', 499)); };
    r.on('close', dc);
    async function em(ev, v) {
      sg.throwIfAborted();
      if (r.destroyed || r.writableEnded) throw er('streamClosed', 499);
      if (ev === 'text' && ft === null) ft = performance.now() - at;
      if (!r.write(`event: ${ev}\ndata: ${JSON.stringify(v)}\n\n`)) await on(r, 'drain', { signal: sg });
    }
    try {
      r.status(200).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      r.flushHeaders();
      await em('meta', { requestId: r.locals.id, sessionId: s.sessionId, timestamp: s.messageHistory.at(-1).timestamp });
      await ax(s, md, ws(cf.TavilyKey, s, sg, em, fe), sg, em, d.mode);
      st = 'complete';
    } catch (e) {
      st = sg.aborted ? 'interrupted' : 'failed';
      cd = sg.aborted ? sg.reason?.code ?? 'generationAborted' : e.code ?? 'generationFailed';
    } finally {
      clearTimeout(tm);
      a.abort();
      ms.cm(s, s.output, st);
      ac.delete(a);
      r.removeListener('close', dc);
      console.info(JSON.stringify({ requestId: r.locals.id, status: st, code: st === 'complete' ? null : cd, firstTextMs: ft, durationMs: performance.now() - at }));
    }
    if (!r.destroyed && !r.writableEnded) {
      const ev = st === 'complete' ? 'done' : 'error';
      const v = st === 'complete' ? { status: st, timestamp: s.messageHistory.at(-1).timestamp } : { error: cd, requestId: r.locals.id, partial: true };
      r.end(`event: ${ev}\ndata: ${JSON.stringify(v)}\n\n`);
    }
  });
  ap.use((e, q, r, nx) => {
    if (r.headersSent) return nx(e);
    const st = e instanceof z.ZodError ? 400 : e.status ?? 500;
    const cd = e instanceof z.ZodError ? 'invalidRequest' : e.type === 'entity.parse.failed' ? 'invalidJson' : e.type === 'entity.too.large' ? 'bodyTooLarge' : e.code ?? 'internalError';
    r.status(st).json({ error: cd, requestId: r.locals.id });
  });
  return { ap, close: () => { clearInterval(tm); for (const a of ac) a.abort(er('serverShutdown', 503)); } };
}
if (process.argv[1] && import.meta.url === pu(process.argv[1]).href) {
  const cf = z.object({ AnthropicKey: z.string().min(1), TavilyKey: z.string().min(1), AppKey: z.string().min(24), Model: z.string().min(1), Port: z.coerce.number().int().min(1).max(65535).default(3000), Host: z.string().default('127.0.0.1') }).parse(process.env);
  const md = ca({ apiKey: cf.AnthropicKey })(cf.Model);
  const s = sv(cf, md);
  const h = s.ap.listen(cf.Port, cf.Host, () => console.info(JSON.stringify({ status: 'listening', port: cf.Port, host: cf.Host })));
  h.requestTimeout = 15000;
  h.headersTimeout = 10000;
  for (const sn of ['SIGINT', 'SIGTERM']) process.once(sn, () => {
    s.close();
    h.close();
    setTimeout(() => h.closeAllConnections(), 5000).unref();
  });
}
