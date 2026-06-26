const fs=require('fs');
const path=require('path');
function walk(dir,acc=[]){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory()){if(e.name==='node_modules'||e.name==='dist')continue;walk(p,acc);}else if(/\.(jsx?|js)$/.test(e.name))acc.push(p);}return acc;}
const files=walk('frontend/src');
// collect words (sequences incl ?) that contain at least one ?
const freq={};
for(const f of files){
  const c=fs.readFileSync(f,'utf8');
  // match tokens: letters + ? but at least one ?
  const re=/[A-Za-zÀ-Ỹà-ỹ?]+/g;
  let m;
  while((m=re.exec(c))){
    const w=m[0];
    if(!w.includes('?')) continue;
    // skip if looks like ternary/optional (handled)
    // require at least one letter?letter
    if(!/[A-Za-zÀ-Ỹà-ỹ]\?[A-Za-zÀ-Ỹà-ỹ]/.test(w)) continue;
    freq[w]=(freq[w]||0)+1;
  }
}
// We want multi-syllable phrases. Instead collect 2-word and 3-word phrases around ?
// Simpler: print bigrams "word1 word2" where either has ?
const bigrams={};
for(const f of files){
  const c=fs.readFileSync(f,'utf8');
  const re=/[A-Za-zÀ-Ỹà-ỹ?]+/g;
  const toks=[]; let m;
  while((m=re.exec(c))) toks.push(m[0]);
  for(let i=0;i<toks.length-1;i++){
    const a=toks[i],b=toks[i+1];
    if((a.includes('?')||b.includes('?')) && a.length>1 && b.length>1){
      const bg=a+' '+b;
      if(/^[A-Za-zÀ-Ỹà-ỹ? ]+$/.test(bg) && /[A-Za-zÀ-Ỹà-ỹ]\?[A-Za-zÀ-Ỹà-ỹ]/.test(bg)){
        bigrams[bg]=(bigrams[bg]||0)+1;
      }
    }
  }
}
const sb=Object.entries(bigrams).sort((a,b)=>b[1]-a[1]);
console.log('=== top bigrams with ? (phrases) ===');
sb.slice(0,120).forEach(([w,n])=>console.log(String(n).padStart(4), JSON.stringify(w)));
console.log('unique bigrams:',sb.length);
