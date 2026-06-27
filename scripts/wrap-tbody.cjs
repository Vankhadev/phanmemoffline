const fs=require('fs');
const f='frontend/src/pages/OrderList.jsx';
let c=fs.readFileSync(f,'utf8');
// Find the td block starting at "{idx + 1}</td>" in edit table (the one with className="py-2 px-3 text-center text-gray-400")
const marker = '<td className="py-2 px-3 text-center text-gray-400">{idx + 1}</td>';
const start = c.indexOf(marker);
console.log('start idx:',start);
if(start<0){ console.log('marker not found'); process.exit(1); }
// Find end: the closing of the removeDetail button td  - search for "removeDetail(idx)}" then next "</td>"
const btnIdx = c.indexOf('removeDetail(idx)}', start);
const endTd = c.indexOf('</td>', btnIdx) + '</td>'.length;
console.log('end:',endTd);
const block = c.slice(start, endTd);
console.log('block len:',block.length);
// Build new block wrapping each td with visible column condition.
// We reconstruct based on known structure.
const newBlock = [
'{editVisibleColumns.stt && <td className="py-2 px-3 text-center text-gray-400">{idx + 1}</td>}',
'{editVisibleColumns.productName && <td className="py-2 px-3">',
'  <div className="font-medium text-gray-800">{getProductDisplayName(d)}</div>',
'  <div className="text-[10px] text-gray-400">{d.product_sku}</div>',
'  {stockState && (',
'    <div className={`text-[10px] font-semibold mt-0.5 ${rowStockInvalid ? \'text-red-600\' : rowNearLimit ? \'text-orange-700\' : \'text-gray-500\'}`}>',
'      Dự kiến {formatStockValue(stockState.projectedStock)}{rowStockInvalid ? ` · ${NEGATIVE_STOCK_LIMIT_MESSAGE}` : rowNearLimit ? ` · ${negativeStockNearLimitLabel || `gần ngưỡng ${negativeStockLimitLabel}`}` : \'\'}',
'    </div>',
'  )}',
'</td>}',
'{editVisibleColumns.quantity && <td className="py-2 px-3 text-center">',
'  <input type="number" min="1"',
'    value={d.quantity}',
'    onChange={e => updateDetail(idx, \'quantity\', +e.target.value)}',
'    className={`w-16 text-center border rounded px-1 py-1 text-sm ${rowStockInvalid ? \'bg-red-100 text-red-700 border-red-300\' : rowNearLimit ? \'bg-orange-50 text-orange-700 border-orange-300\' : \'\'}`} />',
'</td>}',
'{editVisibleColumns.unitPrice && <td className="py-2 px-3 text-right">',
'  <input type="number" min="0"',
'    value={d.unit_price}',
'    onChange={e => updateDetail(idx, \'unit_price\', +e.target.value)}',
'    className="w-24 text-right border rounded px-2 py-1 text-sm" />',
'</td>}',
'{editVisibleColumns.discount && <td className="py-2 px-3 text-center">',
'  <input type="number" min="0" max="100"',
'    value={d.discount_percent}',
'    onChange={e => updateDetail(idx, \'discount_percent\', +e.target.value)}',
'    className="w-14 text-center border rounded px-1 py-1 text-sm" />',
'</td>}',
'{editVisibleColumns.lineTotal && <td className="py-2 px-3 text-right font-semibold text-blue-700">',
'  {formatVND(d.line_total)}',
'</td>}',
'<td className="py-2 px-3 text-center">',
'  <button onClick={() => removeDetail(idx)} className="text-red-400 hover:text-red-600 p-1">',
'    <Trash2 size={13} />',
'  </button>',
'</td>',
].join('\n');
c = c.slice(0,start) + newBlock + c.slice(endTd);
fs.writeFileSync(f,c,'utf8');
console.log('done, new file len:',c.length);