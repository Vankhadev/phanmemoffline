const fs = require('fs');
const p = 'G:/phanmienoffline/frontend/src/pages/OrderList.jsx';
let s = fs.readFileSync(p,'utf8');
s = s.replace("disabled={editDetails.length === 0 || saveLoading || (editProductsValidationEnabled && hasEditStockError)}", "disabled={editDetails.length === 0 || saveLoading || (editProductsState === 'loaded' && hasEditStockError)}");
s = s.replace("                {editProductsValidationEnabled && hasEditStockError && (", "                {editProductsState === 'loaded' && hasEditStockError && (");
s = s.replace("      if (!editProductsValidationEnabled) {\n      return { hasInvalid: false, errors: [], firstError: null, productStates: new Map(), invalidProductIds: new Set(), invalidLineKeys: new Set(), settings: negativeStockSettings, minimumAllowedStock: 0, warningThreshold: 0, limitMessage: '', summaryMessage: '' };\n    }", "      if (!editProductsValidationEnabled) {\n      return { hasInvalid: false, errors: [], firstError: null, productStates: new Map(), invalidProductIds: new Set(), invalidLineKeys: new Set(), settings: negativeStockSettings, minimumAllowedStock: 0, warningThreshold: 0, limitMessage: '', summaryMessage: '' };\n    }");
fs.writeFileSync(p,s);
