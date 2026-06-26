const fs = require('fs');
const path = require('path');
const pairs = JSON.parse(fs.readFileSync(path.join(__dirname, 'vi-repairs.json'), 'utf8'));
pairs.sort((a, b) => String(b[0]).length - String(a[0]).length);
const ROOT = path.join(__dirname, '..', 'frontend', 'src');
const exts = new Set(['.js', '.jsx', '.ts', '.tsx', '.html', '.css']);
function walk(dir, files = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, files);
    else if (e.isFile() && exts.has(path.extname(e.name).toLowerCase())) files.push(full);
  }
  return files;
}
const isWordChar = (c) => /[A-Za-z0-9_]/.test(c);
const looksLikeJsIdentifier = (tok) => /^[A-Za-z]+\?[A-Za-z]+$/.test(tok);
let totalFiles = 0, totalReplacements = 0;
const report = [];
for (const file of walk(ROOT)) {
  let text = fs.readFileSync(file, 'utf8');
  let fileCount = 0;
  for (const [bad, good] of pairs) {
    if (!bad || !good || bad === good) continue;
    if (!text.includes(bad)) continue;
    if (looksLikeJsIdentifier(bad)) continue;
    let out = '';
    let i = 0;
    while ((i = text.indexOf(bad, i)) !== -1) {
      const qIdx = bad.indexOf('?');
      const charAfterQuestionInText = text[i + qIdx + 1] || '';
      const afterBadChar = text[i + bad.length] || '';
      if (charAfterQuestionInText === '.' || charAfterQuestionInText === '(') {
        out += text.slice(0, i + bad.length); text = text.slice(i + bad.length); i = 0; continue;
      }
      const before = i > 0 ? text[i - 1] : '';
      if (isWordChar(before) && isWordChar(afterBadChar)) {
        out += text.slice(0, i + bad.length); text = text.slice(i + bad.length); i = 0; continue;
      }
      out += text.slice(0, i) + good; text = text.slice(i + bad.length); i = 0; fileCount++;
    }
    text = out + text;
  }
  if (fileCount > 0) {
    fs.writeFileSync(file, text, 'utf8');
    totalFiles++; totalReplacements += fileCount;
    report.push(`${path.relative(ROOT, file)}: ${fileCount}`);
  }
}
console.log(`=== repair-vietnamese.js ===\nFiles modified: ${totalFiles}\nTotal replacements: ${totalReplacements}`);
fs.writeFileSync(path.join(__dirname, 'repair-vietnamese-report.txt'), report.join('\n') + '\n', 'utf8');
