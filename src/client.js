import { createInterface as ci } from 'node:readline/promises';
import { stdin as si, stdout as so } from 'node:process';
import { pathToFileURL as pu } from 'node:url';
export function sp() {
  const dc = new TextDecoder();
  let bf = '';
  function fd(by) {
    bf = (bf + dc.decode(by, { stream: true })).replace(/\r\n/g, '\n');
    const ev = [];
    let ix;
    while ((ix = bf.indexOf('\n\n')) >= 0) {
      const tx = bf.slice(0, ix);
      bf = bf.slice(ix + 2);
      const ns = tx.split('\n');
      const en = ns.find(v => v.startsWith('event: '));
      const dn = ns.filter(v => v.startsWith('data: ')).map(v => v.slice(6)).join('\n');
      if (en && dn) ev.push({ event: en.slice(7), data: JSON.parse(dn) });
    }
    return ev;
  }
  return { fd };
}
async function rq(ur, ky, bd) {
  const r = await fetch(ur, { method: 'POST', headers: { Authorization: `Bearer ${ky}`, 'Content-Type': 'application/json' }, body: JSON.stringify(bd) });
  if (!r.ok) {
    const v = await r.json().catch(() => ({}));
    throw new Error(`${v.error ?? 'requestFailed'} (${r.status})`);
  }
  return r;
}
export async function cx(ur = 'http://127.0.0.1:3000', ky = process.env.AppKey) {
  if (!ky) throw new Error('AppKeyMissing');
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const r = await rq(`${ur}/sessions`, ky, { timeZone: tz });
  const s = await r.json();
  const it = ci({ input: si, output: so });
  so.write(`Chat started. Time zone: ${tz}. Type /quit to exit.\n`);
  try {
    while (true) {
      const tx = (await it.question('You: ')).trim();
      if (tx === '/quit') break;
      if (!tx) continue;
      const a = await rq(`${ur}/chat`, ky, { sessionId: s.sessionId, message: tx, mode: 'grounded' });
      const rd = a.body.getReader();
      const ps = sp();
      const sr = new Map();
      let dn = false;
      so.write('Agent: ');
      while (true) {
        const p = await rd.read();
        if (p.done) break;
        for (const e of ps.fd(p.value)) {
          if (e.event === 'text') so.write(e.data.text);
          if (e.event === 'sources') for (const q of e.data.searches ?? []) for (const v of q.results ?? []) sr.set(v.url, v.title || v.url);
          if (e.event === 'done') dn = true;
          if (e.event === 'error') throw new Error(e.data.error ?? 'generationFailed');
        }
      }
      so.write('\n');
      if (!dn) throw new Error('streamIncomplete');
      if (sr.size) {
        so.write('Search sources:\n');
        for (const [u, t] of sr) so.write(`${t}: ${u}\n`);
      }
      so.write('\n');
    }
  } finally {
    it.close();
  }
}
if (process.argv[1] && import.meta.url === pu(process.argv[1]).href) cx().catch(e => { console.error(e.message); process.exitCode = 1; });
