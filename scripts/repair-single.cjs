const fs=require('fs');
const path=require('path');
// Safe single-syllable words (verified no optional-chaining conflict)
const pairs=JSON.parse(fs.readFileSync(path.join(__dirname,'vi-repairs-single.json'),'utf8'));
function walk(dir,acc=[]){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory()){if(e.name==='node_modules'||e.name==='dist')continue;walk(p,acc);}else if(/\.(jsx?|js)$/.test(e.name))acc.push(p);}return acc;}
const isWord=(c)=>/[A-Za-z0-9_]/.test(c);
const ROOT=path.join(__dirname,'..','frontend','src');
let totalFiles=0,total=0;
const rep=[];
for(const file of walk(ROOT)){
  let text=fs.readFileSync(file,'utf8');
  let cnt=0;
  for(const [bad,good] of pairs){
    if(!text.includes(bad)) continue;
    let out='',i=0;
    while((i=text.indexOf(bad,i))>=0){
      const qIdx=bad.indexOf('?');
      const charAfterQ=text[i+qIdx+1]||'';
      const before=text[i-1]||'';
      const after=text[i+bad.length]||'';
      // skip optional chaining / ternary / method call
      if(charAfterQ==='.'||charAfterQ==='('||charAfterQ===':'||charAfterQ==='?'){ out+=text.slice(0,i+bad.length); text=text.slice(i+bad.length); i=0; continue; }
      // skip if embedded in larger identifier (word char before/after)
      if(isWord(before)||isWord(after)){ out+=text.slice(0,i+bad.length); text=text.slice(i+bad.length); i=0; continue; }
      out+=text.slice(0,i)+good; text=text.slice(i+bad.length); i=0; cnt++;
    }
    text=out+text;
  }
  if(cnt>0){ fs.writeFileSync(file,text,'utf8'); totalFiles++; total+=cnt; rep.push(`${path.relative(ROOT,file)}: ${cnt}`); }
}
console.log(`Files: ${totalFiles} Replacements: ${total}`);
rep.forEach(r=>console.log('  '+r));