import { randomUUID as ru } from 'node:crypto';
export function er(cd, st) {
  return Object.assign(new Error(cd), { code: cd, status: st });
}
export function mm(no = Date.now, mx = 1000, tt = 1800000) {
  const ss = new Map();
  function gc() {
    for (const [id, s] of ss) {
      if (!s.busy && no() - s.time >= tt) ss.delete(id);
    }
  }
  function cr(tz = 'UTC') {
    gc();
    if (ss.size >= mx) throw er('sessionCapacity', 503);
    const id = ru();
    const s = { sessionId: id, timestamp: new Date(no()).toISOString(), time: no(), timeZone: tz, messageHistory: [], sequence: 0, busy: false, cache: new Map(), output: '' };
    ss.set(id, s);
    return s;
  }
  function ac(id, tx) {
    gc();
    const s = ss.get(id);
    if (!s) throw er('sessionMissing', 404);
    if (s.busy) throw er('sessionBusy', 409);
    if (Buffer.byteLength(tx) > 6000) throw er('messageTooLarge', 413);
    if (s.messageHistory.length >= 64 || s.messageHistory.reduce((n, m) => n + Buffer.byteLength(m.content), 0) > 40000) throw er('sessionFull', 413);
    s.busy = true;
    s.output = '';
    s.time = no();
    s.messageHistory.push({ role: 'user', content: tx, timestamp: new Date(s.time).toISOString(), sequence: ++s.sequence, status: 'accepted' });
    return s;
  }
  function cm(s, tx, st) {
    if (!s.busy) throw er('invalidCommit', 500);
    s.time = no();
    s.messageHistory.push({ role: 'assistant', content: tx || '[The response ended before producing text.]', timestamp: new Date(s.time).toISOString(), sequence: ++s.sequence, status: st });
    s.busy = false;
    s.output = '';
  }
  return { cr, ac, cm, gc };
}
