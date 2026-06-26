const fs=require('fs');
const path=require('path');
function walk(dir,acc=[]){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory()){if(e.name==='node_modules'||e.name==='dist')continue;walk(p,acc);}else if(/\.(jsx?|js)$/.test(e.name))acc.push(p);}return acc;}
const files=walk('frontend/src');
// Collect remaining "?" in vietnamese context AND optional chaining
const remaining=[];
const optchain={};
for(const f of files){
  const c=fs.readFileSync(f,'utf8');
  const lines=c.split(/\r?\n/);
  for(let i=0;i<lines.length;i++){
    const L=lines[i];
    // find all ?
    let idx=0;
    while((idx=L.indexOf('?',idx))>=0){
      const prev=L[idx-1]||'';
      const next=L[idx+1]||'';
      // optional chaining / ternary-ish: skip
      if(next==='.'||next==='('||next==='?'){ optchain['?'+next]=(optchain['?'+next]||0)+1; idx++; continue; }
      // letter?letter = vietnamese placeholder
      if(/[A-Za-zÀ-Ỹà-ỹ]/.test(prev)&&/[A-Za-zÀ-Ỹà-ỹ]/.test(next)){
        // grab word around
        let s=idx-1,e2=idx+1;
        while(s>0&&/[A-Za-zÀ-Ỹà-ỹ?]/.test(L[s-1]))s--;
        while(e2<L.length&&/[A-Za-zÀ-Ỹà-ỹ?]/.test(L[e2]))e2++;
        const word=L.slice(s,e2);
        remaining.push(word);
      }
      idx++;
    }
  }
}
const freq={};
for(const w of remaining)freq[w]=(freq[w]||0)+1;
const sorted=Object.entries(freq).sort((a,b)=>b[1]-a[1]);
console.log('=== optional-chain ?X (skipped) ===');
console.log(optchain);
console.log('=== remaining vietnamese words with ? (top 80) ===');
sorted.slice(0,80).forEach(([w,n])=>console.log(String(n).padStart(5), JSON.stringify(w)));
console.log('total unique words:',sorted.length);
