const fs=require('fs');
const path=require('path');
const cp1252reverse={0x20AC:0x80,0x201A:0x82,0x192:0x83,0x201E:0x84,0x2026:0x85,0x2020:0x86,0x2021:0x87,0x2C6:0x88,0x2030:0x89,0x160:0x8A,0x2039:0x8B,0x152:0x8C,0x17D:0x8E,0x2018:0x91,0x2019:0x92,0x201C:0x93,0x201D:0x94,0x2022:0x95,0x2013:0x96,0x2014:0x97,0x2DC:0x98,0x2122:0x99,0x161:0x9A,0x203A:0x9B,0x153:0x9C,0x17E:0x9E,0x178:0x9F};
// Any cp1252 mojibake marker char (latin1 high or special). Vietnamese mojibake uses: Ã Ä áº á» Æ Æ° Â and the smart-quote remnants.
// Detect line as mojibake if it has a cp1252 high/special char AND it is NOT a valid vietnamese precomposed sequence.
// Safer: treat line as mojibake if it contains any of these specific 2-char mojibake pairs:
const mojiPairs = ['Ã','Ä','áº','á»','Æ','Â€','Â','â€','Æ°','á»','á»'];
function hasMojibake(L){
  // any char in cp1252 mojibake range that is NOT common correct vietnamese
  // Correct vietnamese uses precomposed: ạ ậ ấ ề ế ớ ờ ... in U+00E0-U+00FF and U+1EA0-U+1EFF.
  // Mojibake cp1252 chars are exactly U+00C0-U+00FF too! e.g. Ã (U+00C3) is both a mojibake marker AND rare vietnamese letter.
  // Distinguish: mojibake lines have BIGRAMS like Ã + lowercase latin (Ã£=ã, Ã©=é...). Correct vietnamese Ã is standalone/final.
  // So: line is mojibake if /Ã[A-Za-z]/ or /Ä[A-Za-z]/ or /áº[Â«-\u00BF]/ or /á»[Â«-\u00BF]/ or /Æ[°A-Za-z]/ or /â€/
  return /Ã[A-Za-zÀ-ÿ]/.test(L) || /Ä[A-Za-zÀ-ÿ\u2018-\u201F]/.test(L) || /áº[\u00AB-\u00BF]/.test(L) || /á»[\u00AB-\u00BF]/.test(L) || /Æ[°A-Za-z]/.test(L) || /â€/.test(L) || /Â[\u0080-\u00BF]/.test(L);
}
function walk(dir,acc=[]){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory()){if(e.name==='node_modules'||e.name==='dist')continue;walk(p,acc);}else if(/\.(jsx?|js)$/.test(e.name))acc.push(p);}return acc;}
function reverseCp1252(s){
  const bytes=[]; let ok=true;
  for(const ch of s){ const cp=ch.codePointAt(0);
    if(cp<=0x7F) bytes.push(cp);
    else if(cp>=0xA0&&cp<=0xFF) bytes.push(cp);
    else if(cp1252reverse[cp]!==undefined) bytes.push(cp1252reverse[cp]);
    else if(cp>=0x80&&cp<=0x9F) bytes.push(cp);
    else { ok=false; break; }
  }
  return ok?Buffer.from(bytes):null;
}
const ROOT=path.join(__dirname,'..','frontend','src');
let totalFiles=0,totalLines=0,failed=0;
const rep=[];
for(const file of walk(ROOT)){
  const c=fs.readFileSync(file,'utf8');
  const lines=c.split(/\r?\n/);
  let changed=false,lc=0;
  for(let i=0;i<lines.length;i++){
    if(!hasMojibake(lines[i])) continue;
    const r=reverseCp1252(lines[i]);
    if(r){ const dec=r.toString('utf8'); if(dec!==lines[i] && !hasMojibake(dec)){ lines[i]=dec; changed=true; lc++; } else failed++; }
    else failed++;
  }
  if(changed){ fs.writeFileSync(file,lines.join('\n'),'utf8'); totalFiles++; totalLines+=lc; rep.push(`${path.relative(ROOT,file)}: ${lc}`); }
}
console.log(`Files: ${totalFiles} Lines: ${totalLines} failed: ${failed}`);
rep.slice(0,30).forEach(r=>console.log('  '+r));