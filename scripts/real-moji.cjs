const fs=require('fs');
const path=require('path');
function walk(dir,acc=[]){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory()){if(e.name==='node_modules'||e.name==='dist')continue;walk(p,acc);}else if(/\.(jsx?|js)$/.test(e.name))acc.push(p);}return acc;}
// REAL mojibake markers (the cp1252 byte sequences that are NOT valid vietnamese)
// Valid vietnamese precomposed: U+00C0-U+024F includes ẤẦẬ... but those are U+1EA0-U+1EFF.
// cp1252 mojibake specifically: Ã followed by latin = byte 0xC3+letter. In UTF-8 of mojibake, Ã is U+00C3.
// But correct vietnamese also has Ã? No - Ã (A with tilde) is not a vietnamese letter. Only ã ẫ õ ỗ are.
// So Ã (U+00C3 uppercase) = mojibake marker. Ä (U+00C4) = mojibake. áº (U+00E1 U+00BA) = mojibake.
// Check via codepoints directly.
let total=0; const byFile={};
for(const f of walk('frontend/src')){
  const c=fs.readFileSync(f,'utf8');
  const lines=c.split(/\r?\n/);
  for(const L of lines){
    let isMojibake=false;
    // U+00C3 (Ã) followed by a letter => mojibake (Ã©=ế byte c3 a9)
    // U+00C4 (Ä) followed by letter => mojibake
    // sequence U+00E1 U+00BA (áº) => mojibake
    // sequence U+00E1 U+00BB (á») => mojibake
    // U+00C6 (Æ) followed by letter => mojibake
    for(let i=0;i<L.length;i++){
      const cp=L.charCodeAt(i);
      const next=L.charCodeAt(i+1);
      if(cp===0xC3 && next>=0x41 && next<=0x7A){ isMojibake=true; break; }
      if(cp===0xC4 && next>=0x41 && next<=0x7A){ isMojibake=true; break; }
      if(cp===0xE1 && (next===0xBA||next===0xBB)){ isMojibake=true; break; }
      if(cp===0xC6 && next>=0x41 && next<=0x7A){ isMojibake=true; break; }
    }
    if(isMojibake){ total++; byFile[path.basename(f)]=(byFile[path.basename(f)]||0)+1; }
  }
}
console.log('REAL mojibake lines:',total);
console.log(JSON.stringify(byFile,null,0));