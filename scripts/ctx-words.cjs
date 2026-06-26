const fs=require('fs');
const path=require('path');
function walk(dir,acc=[]){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory()){if(e.name==='node_modules'||e.name==='dist')continue;walk(p,acc);}else if(/\.(jsx?|js)$/.test(e.name))acc.push(p);}return acc;}
// remaining single words with ? - show context for high-freq ambiguous ones
const targets=['nh?n','c?a','m?i','c?c','n?u','d?n','tr?n','t?nh','c?i','b?ng','b?t','v?o','d?u','t?ng','phi?u','th?ng'];
for(const t of targets){
  const ctx=[];
  for(const f of walk('frontend/src')){
    const c=fs.readFileSync(f,'utf8');
    let i=0;
    while((i=c.indexOf(t,i))>=0){
      const before=c[i-1]||'',after=c[i+t.length]||'';
      if(!/[A-Za-z0-9_]/.test(before)&&!/[A-Za-z0-9_]/.test(after)){
        const s=Math.max(0,i-12),e=Math.min(c.length,i+t.length+12);
        ctx.push(c.slice(s,e).replace(/\n/g,' '));
      }
      i++;
      if(ctx.length>=4)break;
    }
    if(ctx.length>=4)break;
  }
  console.log(t+' => '+ctx.slice(0,4).join(' | '));
}