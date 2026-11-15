import fs from 'fs';
const src = fs.readFileSync(new URL('../../../index.html', import.meta.url),'utf8').split(/\r?\n/);
// function defs
const defs=[]; // {name,line}
src.forEach((l,i)=>{ const m=l.match(/^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/); if(m) defs.push({name:m[1],line:i+1});
  const m2=l.match(/^\s*(?:window\.)?([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?function\b/); if(m2) defs.push({name:m2[1],line:i+1}); });
defs.sort((a,b)=>a.line-b.line);
function encl(line){ let lo=0,hi=defs.length-1,ans=null; while(lo<=hi){const mid=(lo+hi)>>1; if(defs[mid].line<=line){ans=defs[mid];lo=mid+1}else hi=mid-1;} return ans&&ans.name; }
// page -> render fn from renderPage
const rpStart = src.findIndex(l=>/function renderPage\s*\(/.test(l));
const pageOf=Object.create(null); let cur=null;
for(let i=rpStart;i<rpStart+400;i++){ const l=src[i]; const cs=[...l.matchAll(/case\s+'([\w-]+)'/g)].map(m=>m[1]); if(cs.length) cur=cs; const fm=[...l.matchAll(/\b(render[A-Z]\w*)\s*\(/g)].map(m=>m[1]); if(cur&&fm.length){ for(const f of fm) for(const c of cur) (pageOf[f]=pageOf[f]||new Set()).add(c);} if(/break;|return/.test(l) && !cs.length) {} }
const renderSet=new Set(Object.keys(pageOf));
// callers index: name -> enclosing fns
const callIdx=Object.create(null);
src.forEach((l,i)=>{ for(const m of l.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)){ (callIdx[m[1]]=callIdx[m[1]]||[]).push(i+1);} });
function pagesFor(fn, depth=0, seen=new Set()){
  if(seen.has(fn)||depth>5) return new Set(); seen.add(fn);
  if(renderSet.has(fn)) return new Set(pageOf[fn]);
  const out=new Set();
  for(const ln of (callIdx[fn]||[])){ const e=encl(ln); if(!e||e===fn) continue; for(const p of pagesFor(e,depth+1,seen)) out.add(p); if(out.size>6) break; }
  return out;
}
const modals=JSON.parse(fs.readFileSync('modals.json','utf8'));
const res=Object.create(null); const fnSeen=new Set();
for(const m of modals){ if(fnSeen.has(m.fn)) continue; fnSeen.add(m.fn); const ps=[...pagesFor(m.fn)]; res[m.fn]={title:m.title, pages:ps}; }
fs.writeFileSync('modal_pages.json', JSON.stringify({pageOf:Object.fromEntries(Object.entries(pageOf).map(([k,v])=>[k,[...v]])), res},null,1));
const none=Object.entries(res).filter(([k,v])=>!v.pages.length);
console.log('render fns',renderSet.size,'modal fns',Object.keys(res).length,'mapped',Object.keys(res).length-none.length,'unmapped',none.length);
console.log(none.slice(0,40).map(([k,v])=>k+'「'+(v.title||'').slice(0,15)+'」').join(' '));
