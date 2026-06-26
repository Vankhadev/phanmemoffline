const fs=require('fs');
const path=require('path');
function walk(dir,acc=[]){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory()){if(e.name==='node_modules'||e.name==='dist')continue;walk(p,acc);}else if(/\.(jsx?|js)$/.test(e.name))acc.push(p);}return acc;}
const isLetterLike=(cp)=>(cp>=0x41&&cp<=0x5A)||(cp>=0x61&&cp<=0x7A)||(cp>=0xC0&&cp<=0xFF)||(cp>=0x100&&cp<=0x24F)||(cp>=0x1EA0&&cp<=0x1EFF);
function hasMojibake(L){ for(let i=0;i<L.length;i++){const cp=L.charCodeAt(i),next=L.charCodeAt(i+1); if((cp===0xC3||cp===0xC4||cp===0xC6)&&isLetterLike(next))return true; if(cp===0xE1&&(next===0xBA||next===0xBB))return true; if(cp===0xE2&&next===0x20AC)return true;} return false; }
// remaining ? in vietnamese (letter?letter, excluding optional chaining)
function hasQ(L){ return /[A-Za-z\u00C0-\u024F\u1EA0-\u1EFF]\?[A-Za-z\u00C0-\u024F\u1EA0-\u1EFF]/.test(L); }
let moji=0,q=0; const mojiFiles={},qFiles={};
for(const f of walk('frontend/src')){
  const c=fs.readFileSync(f,'utf8');
  for(const L of c.split(/\r?\n/)){
    if(hasMojibake(L)){moji++; mojiFiles[path.basename(f)]=(mojiFiles[path.basename(f)]||0)+1;}
    if(hasQ(L)){q++; qFiles[path.basename(f)]=(qFiles[path.basename(f)]||0)+1;}
  }
}
console.log('cp1252 mojibake lines:',moji);
console.log('  files:',JSON.stringify(mojiFiles));
console.log('? vietnamese lines:',q,'(top files)');
const sorted=Object.entries(qFiles).sort((a,b)=>b[1]-a[1]).slice(0,15);
sorted.forEach(([f,n])=>console.log('  ',n,f));