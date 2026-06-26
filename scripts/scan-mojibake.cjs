const fs = require('fs');
const path = require('path');

function walk(dir, acc=[]) {
  for (const e of fs.readdirSync(dir, {withFileTypes:true})) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name==='node_modules'||e.name==='dist') continue; walk(p,acc); }
    else if (/\.(jsx?|js)$/.test(e.name)) acc.push(p);
  }
  return acc;
}

const files = walk('frontend/src');
// Latin-1 mojibake of Vietnamese (UTF-8 bytes decoded as Latin-1)
const latin1 = /[\u00C0-\u00FF\u0152\u0153\u0178\u2018-\u201F\u2026\u20AC\u2122]/;
// vietnamese diacritic sequences from latin1 mojibake
const mojiSeq = /Ã©|Ã¨|Ãª|Ã«|Ã |Ã¡|Ã¢|Ã£|áº|á»|á»|á»|á»|á»|á»|á»|á»|á»|á»|Ä|Äƒ|Æ|Æ°|Æ¡|Æ|Ã´|Ã³|Ã²|Ãµ|Ã­|Ã¬|Ã®|Ä‘|Æ¡|Æ°/;

let totalLatin1=0, totalQ=0;
const byFile={};
for (const f of files) {
  const c = fs.readFileSync(f,'utf8');
  const lines = c.split(/\r?\n/);
  let lf=0, qf=0;
  for (let i=0;i<lines.length;i++){
    const L=lines[i];
    if (latin1.test(L)) { lf++; totalLatin1++; }
    // question mark inside vietnamese text context (letter?letter), excluding ?.  and ? : and ??
    const m = L.match(/[A-Za-zÀ-Ỹà-ỹ][?][A-Za-zÀ-Ỹà-ỹ]/g);
    if (m) { qf += m.length; totalQ += m.length; }
  }
  if (lf||qf) byFile[f]={latin1:lf, q:qf};
}
console.log('FILES:', files.length);
console.log('TOTAL latin1 mojibake lines:', totalLatin1);
console.log('TOTAL letter?letter occurrences:', totalQ);
console.log('--- per file (top 40) ---');
Object.entries(byFile).sort((a,b)=> (b[1].latin1+b[1].q)-(a[1].latin1+a[1].q)).slice(0,40)
  .forEach(([f,v])=> console.log(String(v.latin1).padStart(4), String(v.q).padStart(4), f));
