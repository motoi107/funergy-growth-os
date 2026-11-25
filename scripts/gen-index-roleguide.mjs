#!/usr/bin/env node
// キャリア・育成（A-1・v1213）：制度・役割ガイドの文のマスターを、index.html の印のあいだに入れる。
//   node scripts/gen-index-roleguide.mjs          … index.html の印のあいだを作り直す
//   node scripts/gen-index-roleguide.mjs --check  … 作り直したものと今の index.html が 1 文字も違わないか（違えば 1 で終わる・CI）
// 中身：careerscore/role-guide-q4-v1.json をそのまま window.FUNERGY_ROLE_GUIDE に。
// 評価の項目・配点・基準点・最低条件は careerscore/cs-q4-v1.json（window.FUNERGY_CSQ4_MASTER・gen-index-csq4.mjs）が正本。
// ここは文（役割の要約・担当範囲・任せる仕事・指導と育成・次の段階・業務の分担）だけ。項目の ID はかならず Q4 のマスターにあるものだけ（無ければ止まる）。
// 制度は G1〜G6（G7 は入れない・Moto さん 11/24）。依存なし（Node だけ）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const GUIDE = 'careerscore/role-guide-q4-v1.json';
export const MASTER = 'careerscore/cs-q4-v1.json';
export const HTML = 'index.html';
export const BEGIN = '/* ==== FUNERGY_ROLE_GUIDE gen begin ==== */';
export const END = '/* ==== FUNERGY_ROLE_GUIDE gen end ==== */';
export const GRADES = { G: ['G1', 'G2', 'G3', 'G4', 'G5', 'G6'], S_CHEF: ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'], S_OFFICE: ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'], PREP: ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'] };
const MARKS = ['lead', 'do', 'support', 'approve'];

function txt(o, where) {
  if (!o || typeof o !== 'object' || typeof o.ja !== 'string' || !o.ja || typeof o.en !== 'string' || !o.en) throw new Error(where + ': needs ja and en');
}

// 形と中身を確かめる（合わなければ例外）。試験からも使う
export function check(guide, master) {
  if (guide.version !== 'ROLE_GUIDE_2026_Q4_V1') throw new Error('unexpected guide version: ' + guide.version);
  if (guide.basedOn !== master.version) throw new Error('basedOn ' + guide.basedOn + ' does not match master ' + master.version);
  if (!['draft', 'published'].includes(guide.status)) throw new Error('status must be draft or published');
  if (guide.status === 'published' && !(guide.approval && guide.approval.by && guide.approval.at)) throw new Error('published needs approval.by and approval.at');
  if (!guide.en || !['draft', 'published'].includes(guide.en.status)) throw new Error('en.status must be draft or published');
  if (guide.en.status === 'published' && !(guide.en.approval && guide.en.approval.by && guide.en.approval.at)) throw new Error('en published needs approval');
  const ids = {};
  for (const [k, s] of Object.entries(master.systems)) {
    ids[k] = new Set((s.items || []).map((i) => i.id));
    for (const q of s.quality || []) ids[k].add(q.id);
  }
  const keys = (guide.systems || []).map((s) => s.key);
  if (keys.join(',') !== Object.keys(GRADES).join(',')) throw new Error('systems must be ' + Object.keys(GRADES).join(','));
  for (const s of guide.systems) {
    txt(s.name, s.key + '.name');
    const gs = (s.grades || []).map((g) => g.grade);
    if (gs.join(',') !== GRADES[s.key].join(',')) throw new Error(s.key + ': grades must be ' + GRADES[s.key].join(','));
    const itemsOk = (list, where) => { for (const id of list || []) if (!ids[s.key].has(id)) throw new Error(where + ': unknown item ' + id); };
    s.grades.forEach((g, i) => {
      const w = s.key + '.' + g.grade;
      txt(g.summary, w + '.summary'); txt(g.scope, w + '.scope'); txt(g.develop, w + '.develop');
      if (g.position !== undefined) { txt(g.position, w + '.position'); if (typeof g.position.src !== 'string' || !g.position.src) throw new Error(w + '.position needs src'); }
      itemsOk(g.develop.items, w + '.develop');
      if (!Array.isArray(g.tasks) || !g.tasks.length) throw new Error(w + ': tasks');
      g.tasks.forEach((t, j) => { txt(t, w + '.tasks.' + j); itemsOk(t.items, w + '.tasks.' + j); });
      const last = i === s.grades.length - 1;
      if (last ? g.next !== null : (txt(g.next, w + '.next'), false)) throw new Error(w + ': the last grade has no next');
    });
    const seen = new Set();
    for (const d of s.duties || []) {
      const w = s.key + '.' + d.id;
      if (seen.has(d.id)) throw new Error(w + ': duplicate id'); seen.add(d.id);
      txt(d.area, w + '.area'); txt(d.duty, w + '.duty'); if (d.note) txt(d.note, w + '.note');
      itemsOk(d.items, w);
      for (const [g, m] of Object.entries(d.marks || {})) {
        if (!GRADES[s.key].includes(g)) throw new Error(w + ': unknown grade ' + g);
        if (!MARKS.includes(m)) throw new Error(w + ': unknown mark ' + m);
      }
    }
  }
  for (const [i, n] of (guide.notes || []).entries()) { txt(n, 'notes.' + i); if (typeof n.src !== 'string' || !n.src) throw new Error('notes.' + i + ' needs src'); }
  if (/G7/.test(JSON.stringify(guide.systems))) throw new Error('G7 is not part of the system (G1–G6)');
  return true;
}

export function block(root = ROOT) {
  const guide = JSON.parse(fs.readFileSync(path.join(root, GUIDE), 'utf8'));
  const master = JSON.parse(fs.readFileSync(path.join(root, MASTER), 'utf8'));
  check(guide, master);
  const json = JSON.stringify(guide).replace(/<\//g, '<\\/');
  return BEGIN + '\n'
    + '// 自動で作った部分。手で直さない（' + GUIDE + ' を直して `node scripts/gen-index-roleguide.mjs` を流す）。\n'
    + 'window.FUNERGY_ROLE_GUIDE = ' + json + ';\n'
    + END;
}

export function gen(root = ROOT) {
  const html = fs.readFileSync(path.join(root, HTML), 'utf8');
  const a = html.indexOf(BEGIN), b = html.indexOf(END);
  if (a < 0 || b < a || html.indexOf(BEGIN, a + 1) >= 0 || html.indexOf(END, b + 1) >= 0) throw new Error(HTML + ': the ROLE_GUIDE markers must appear once each, in order');
  return html.slice(0, a) + block(root) + html.slice(b + END.length);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = gen();
  const file = path.join(ROOT, HTML);
  if (process.argv.includes('--check')) {
    if (fs.readFileSync(file, 'utf8') !== out) { console.error(HTML + ': the ROLE_GUIDE block is out of date: run node scripts/gen-index-roleguide.mjs'); process.exit(1); }
    console.log(HTML + ': the ROLE_GUIDE block is up to date');
  } else {
    fs.writeFileSync(file, out);
    console.log('wrote the ROLE_GUIDE block in ' + HTML + ' (' + block().length + ' chars)');
  }
}
