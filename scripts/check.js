import { parse as pa } from 'acorn';
import { readdirSync as rd, readFileSync as rf } from 'node:fs';
import { join as jn } from 'node:path';
import { strict as as } from 'node:assert';
function bn(n) {
  if (!n) return;
  if (n.type === 'Identifier') as.match(n.name, /^(?!l$)[A-Za-z]{1,2}$/, `Invalid binding: ${n.name}`);
  if (n.type === 'ObjectPattern') for (const p of n.properties) bn(p.type === 'RestElement' ? p.argument : p.value);
  if (n.type === 'ArrayPattern') for (const p of n.elements) bn(p);
  if (n.type === 'AssignmentPattern') bn(n.left);
  if (n.type === 'RestElement') bn(n.argument);
}
function ck(n) {
  if (!n || typeof n !== 'object') return;
  if (n.type === 'VariableDeclarator') bn(n.id);
  if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(n.type)) {
    bn(n.id);
    for (const p of n.params) bn(p);
  }
  if (n.type === 'CatchClause') bn(n.param);
  if (['ImportSpecifier', 'ImportDefaultSpecifier', 'ImportNamespaceSpecifier'].includes(n.type)) bn(n.local);
  for (const v of Object.values(n)) {
    if (Array.isArray(v)) for (const c of v) ck(c);
    else if (v && typeof v === 'object') ck(v);
  }
}
for (const d of ['src', 'scripts', 'test']) {
  for (const f of rd(d).filter(f => f.endsWith('.js'))) {
    const p = jn(d, f);
    const tx = rf(p, 'utf8');
    as.equal(tx.trimEnd().split(/\r?\n/).some(v => !v.trim()), false, `Blank line in ${p}`);
    const cs = [];
    const tr = pa(tx, { ecmaVersion: 'latest', sourceType: 'module', onComment: cs });
    as.equal(cs.length, 0, `Comment in ${p}`);
    ck(tr);
  }
}
console.info('Code style and syntax checks passed.');
