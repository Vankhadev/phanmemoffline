import os, re, json
root = r'G:\phanmienoffline'
report = []
paths = []
for base, dirs, files in os.walk(root):
    if 'node_modules' in base or '\\.git' in base:
        continue
    for f in files:
        if f.endswith(('.js','.jsx','.ts','.tsx','.json','.md')):
            paths.append(os.path.join(base,f))
patterns = [
    r'customers?\\b', r'active\\s*!==\\s*0', r'createCustomer', r'fetchList', r'insert\\(', r'update\\(', r'writeFile', r'persist', r'AsyncLocalStorage', r'setTimeout', r'queue', r'debounce', r'await\\s+create', r'await\\s+apiJson', r'customers\\)', r'\\/customers'
]
compiled = [re.compile(p, re.I) for p in patterns]
for p in paths:
    try:
        txt = open(p, 'r', encoding='utf-8', errors='ignore').read().splitlines()
    except Exception:
        continue
    hits = []
    for i,line in enumerate(txt,1):
        if any(rx.search(line) for rx in compiled):
            hits.append((i,line.strip()))
    if hits:
        report.append({'path': p, 'hits': hits[:80]})
out = os.path.join(root, 'tmp', 'customer_order_scan_report.json')
os.makedirs(os.path.dirname(out), exist_ok=True)
with open(out, 'w', encoding='utf-8') as f:
    json.dump(report, f, ensure_ascii=False, indent=2)
print(out)
print('files', len(report))
