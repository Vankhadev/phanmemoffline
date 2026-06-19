const fs = require('fs');
const p='G:/phanmienoffline/frontend/src/pages/Customers.jsx';
let s = fs.readFileSync(p,'utf8');
s = s.replace(/<button onClick=\{openImportFilePicker\}([\s\S]*?)<\/button>/, `<button type="button" onClick={openImportFilePicker}$1</button>`);
s = s.replace(/<button onClick=\{exportCustomersList\}/, '<button type="button" onClick={exportCustomersList}');
s = s.replace(/<button onClick=\{\(\) => setShowTypeManager\(true\)\}/, '<button type="button" onClick={() => setShowTypeManager(true)}');
s = s.replace(/<button onClick=\{openAdd\} className="btn-primary flex items-center gap-1">/, '<button type="button" onClick={openAdd} className="btn-primary flex items-center gap-1">');
s = s.replace(/<button onClick=\{\(\) => setShowForm\(false\)\} className="btn-secondary[^>]*>/, '<button type="button" onClick={() => setShowForm(false)} className="btn-secondary');
fs.writeFileSync(p,s);
