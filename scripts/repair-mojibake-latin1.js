const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', 'frontend', 'src');
const exts = new Set(['.js', '.jsx', '.ts', '.tsx']);
function hasMojibake(s) { if (s.indexOf(String.fromCharCode(0xFFFD)) >= 0) return false; let count = 0; for (const ch of s) { const c = ch.charCodeAt(0); if (c >= 0xC0 && c <= 0xFF) count++; } return count >= 2; }
function walk(dir, files = []) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { if (e.name === 'node_modules' || e.name === 'dist') continue; const full = path.join(dir, e.name); if (e.isDirectory()) walk(full, files); else if (e.isFile() && exts.has(path.extname(e.name).toLowerCase())) files.push(full); } return files; }
function repairText(text) { let out = ''; let i = 0; let count = 0; while (i < text.length) { const ch = text[i]; if (ch === String.fromCharCode(39) || ch === String.fromCharCode(34)) { const quote = ch; let j = i + 1; let content = ''; while (j < text.length && text[j] !== quote) { if (text[j] === String.fromCharCode(92)) { content += text[j] + (text[j+1] || ''); j += 2; continue; } content += text[j]; j++; } if (j < text.length && text[j] === quote) { if (hasMojibake(content)) { try { const fixed = Buffer.from(content, 'latin1').toString('utf8'); if (fixed !== content && !hasMojibake(fixed)) { out += quote + fixed + quote; count++; i = j + 1; continue; } } catch (_) {} } out += quote + content + quote; i = j + 1; continue; } } out += ch; i++; } return { text: out, count }; }
let tf = 0, tr = 0;
for (const file of walk(ROOT)) { const text = fs.readFileSync(file, 'utf8'); const r = repairText(text); if (r.count > 0) { fs.writeFileSync(file, r.text, 'utf8'); tf++; tr += r.count; console.log(path.relative(ROOT, file) + ': ' + r.count); } }
console.log('Files: ' + tf + ', Replacements: ' + tr);
