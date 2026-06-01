#!/usr/bin/env node

const { ensurePrintTemplatesSchema } = require('../src/db/printTemplatesSchema');
const { closePrintTemplatesPool, getPrintTemplatesMySqlStatus } = require('../src/db/printTemplatesMySql');

async function main() {
  try {
    const result = await ensurePrintTemplatesSchema({ failSoft: false });
    console.log('[KHA PRINT TEMPLATES MYSQL] Đã khởi tạo schema:', JSON.stringify(result));
  } catch (error) {
    const status = getPrintTemplatesMySqlStatus();
    console.error('[KHA PRINT TEMPLATES MYSQL] Không thể khởi tạo schema print_templates.');
    console.error(`Lỗi: ${error.message}`);
    console.error('Trạng thái:', JSON.stringify({ configured: status.configured, mode: status.mode, missing: status.missing, lastError: status.lastError }, null, 2));
    process.exitCode = 1;
  } finally {
    try {
      await closePrintTemplatesPool();
    } catch (_error) {
      // Ignore shutdown errors.
    }
  }
}

main();
