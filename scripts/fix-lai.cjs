const fs=require('fs');
const path=require('path');
// Context-specific: "X lại" where X in known verbs (the mojibake is l?i which we wrongly mapped to lỗi)
// Fix: replace "verb + l?i" -> "verb + lại" for these verbs (only where l?i currently, or where we wrote lỗi wrongly)
const phrases=[
  ['đăng nhập lỗi','đăng nhập lại'],
  ['t?i lỗi','tải lại'],  // t?i still has ?
  ['tải lỗi','tải lại'],
  ['kh?i d?ng lỗi','khởi động lại'],
  ['khởi động lỗi','khởi động lại'],
  ['th? lỗi','thử lại'],
  ['thử lỗi','thử lại'],
  ['tr? l?i','trở lại'],
  ['m? lỗi','mở lại'],
  ['v?o lỗi','vào lại'],
  ['ch?y lỗi','chạy lại'],
];
function walk(dir,acc=[]){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory()){if(e.name==='node_modules'||e.name==='dist')continue;walk(p,acc);}else if(/\.(jsx?|js)$/.test(e.name))acc.push(p);}return acc;}
const ROOT=path.join(__dirname,'..','frontend','src');
let totalFiles=0,total=0; const rep=[];
for(const file of walk(ROOT)){
  let c=fs.readFileSync(file,'utf8'); let cnt=0;
  for(const [bad,good] of phrases){ if(c.includes(bad)){ const n=c.split(bad).length-1; c=c.split(bad).join(good); cnt+=n; } }
  if(cnt>0){ fs.writeFileSync(file,c,'utf8'); totalFiles++; total+=cnt; rep.push(`${path.relative(ROOT,file)}: ${cnt}`); }
}
console.log(`Files: ${totalFiles} Replacements: ${total}`);
rep.forEach(r=>console.log('  '+r));