/**
 * Inventory Audit Service - Bot Kho Hàng Telegram Report
 * 
 * Kiểm tra tồn kho toàn diện:
 * 1. Tổng quan tồn kho (dòng tồn kho, tồn kho SP cha, tồn kho biến thể, tổng tồn kho).
 * 2. Cảnh báo sản phẩm còn ít và âm kho - vui lòng nhập hàng.
 * 3. Danh sách sản phẩm âm kho.
 * 4. Danh sách sản phẩm còn ít.
 * 5. Danh sách sản phẩm cha còn nhiều (tên và số lượng).
 * 6. Danh sách sản phẩm biến thể (tên và số lượng).
 * 7. Báo cáo về Telegram qua Bot Kho Hàng (bot_inventory).
 */

const { getAll } = require('../db/database');
const { isActiveProduct } = require('./productUpsertService');
const { getTelegramSettings, sendRawTelegramMessage } = require('./telegramService');

const DEFAULT_LIST_LIMIT = 25; // Giới hạn số dòng chi tiết mỗi danh mục trong tin nhắn để không bị spam Telegram

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatStock(val) {
  const n = Number(val || 0);
  return Number.isInteger(n) ? n.toLocaleString('vi-VN') : n.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
}

function formatTimestamp(d = new Date()) {
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Chia nhỏ danh sách dòng thành các tin nhắn <= maxLen ký tự để không bao giờ bị lỗi giới hạn 4096 ký tự của Telegram.
 */
function chunkMessageLines(header, lines, footer = '', maxLen = 3800) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return [`${header}\n<i>(Không có mục nào)</i>${footer ? `\n${footer}` : ''}`];
  }

  const messages = [];
  let currentLines = [];
  let currentLen = header.length + (footer ? footer.length + 1 : 0);

  for (const line of lines) {
    const lineLen = line.length + 1;
    if (currentLen + lineLen > maxLen && currentLines.length > 0) {
      messages.push(`${header}\n${currentLines.join('\n')}${footer ? `\n${footer}` : ''}`);
      currentLines = [];
      currentLen = header.length + (footer ? footer.length + 1 : 0);
    }
    currentLines.push(line);
    currentLen += lineLen;
  }

  if (currentLines.length > 0) {
    messages.push(`${header}\n${currentLines.join('\n')}${footer ? `\n${footer}` : ''}`);
  }

  if (messages.length > 1) {
    return messages.map((msg, idx) => `${msg}\n<i>(Trang ${idx + 1}/${messages.length})</i>`);
  }
  return messages;
}

/**
 * Thu thập và phân tích dữ liệu kiểm kho toàn bộ sản phẩm
 */
function buildInventoryAuditData() {
  const allActive = getAll('products', p => isActiveProduct(p));
  const parentById = new Map();

  const parents = [];
  const variants = [];

  for (const p of allActive) {
    const parentId = Number(p.parent_id);
    if (parentId && parentId > 0) {
      variants.push(p);
    } else {
      parents.push(p);
      parentById.set(Number(p.id), p);
    }
  }

  // Tồn kho sản phẩm cha
  const totalParentStock = parents.reduce((sum, p) => sum + (Number(p.stock) || 0), 0);
  // Tồn kho biến thể
  const totalVariantStock = variants.reduce((sum, v) => sum + (Number(v.stock) || 0), 0);
  // Tổng tồn kho toàn bộ
  const totalCombinedStock = totalParentStock + totalVariantStock;

  // 1. Sản phẩm âm kho (stock < 0)
  const negativeProducts = allActive
    .filter(p => (Number(p.stock) || 0) < 0)
    .sort((a, b) => (Number(a.stock) || 0) - (Number(b.stock) || 0));

  // 2. Sản phẩm còn ít / sắp hết hàng (0 <= stock < 10)
  const lowStockProducts = allActive
    .filter(p => {
      const stock = Number(p.stock) || 0;
      return stock >= 0 && stock < 10;
    })
    .sort((a, b) => (Number(a.stock) || 0) - (Number(b.stock) || 0));

  // 3. Sản phẩm cha còn nhiều (stock >= 30 hoặc top cha có tồn kho lớn nhất)
  const abundantThreshold = 30;
  let abundantParents = parents
    .filter(p => (Number(p.stock) || 0) >= abundantThreshold)
    .sort((a, b) => (Number(b.stock) || 0) - (Number(a.stock) || 0));

  // Nếu số lượng SP cha có tồn >= 30 ít hơn 10 sản phẩm, lấy ngưỡng >= 10 để báo cáo đầy đủ
  if (abundantParents.length < 10) {
    abundantParents = parents
      .filter(p => (Number(p.stock) || 0) >= 10)
      .sort((a, b) => (Number(b.stock) || 0) - (Number(a.stock) || 0));
  }

  // 4. Sản phẩm biến thể (các biến thể đang có trong kho, ưu tiên còn hàng)
  const inStockVariants = variants
    .filter(v => (Number(v.stock) || 0) > 0)
    .sort((a, b) => (Number(b.stock) || 0) - (Number(a.stock) || 0));

  // Helper lấy tên hiển thị đầy đủ (bao gồm tên cha nếu là biến thể)
  const getFullDisplayName = (item) => {
    const parentId = Number(item.parent_id);
    if (parentId && parentId > 0) {
      const parent = parentById.get(parentId);
      if (parent && parent.name && !item.name.toLowerCase().includes(parent.name.toLowerCase())) {
        return `${parent.name} - ${item.name}`;
      }
    }
    return item.name || 'Không có tên';
  };

  return {
    stats: {
      totalRows: allActive.length,
      totalParentsCount: parents.length,
      totalVariantsCount: variants.length,
      totalParentStock,
      totalVariantStock,
      totalCombinedStock,
      negativeCount: negativeProducts.length,
      lowStockCount: lowStockProducts.length,
      abundantParentsCount: abundantParents.length,
      inStockVariantsCount: inStockVariants.length,
      generatedAt: new Date().toISOString(),
    },
    negativeProducts: negativeProducts.map(p => ({
      id: p.id,
      name: getFullDisplayName(p),
      sku: p.sku || '',
      stock: Number(p.stock) || 0,
      unit: p.unit || 'cái',
      isVariant: Boolean(p.parent_id),
    })),
    lowStockProducts: lowStockProducts.map(p => ({
      id: p.id,
      name: getFullDisplayName(p),
      sku: p.sku || '',
      stock: Number(p.stock) || 0,
      unit: p.unit || 'cái',
      isVariant: Boolean(p.parent_id),
    })),
    abundantParents: abundantParents.map(p => ({
      id: p.id,
      name: p.name || 'Không có tên',
      sku: p.sku || '',
      stock: Number(p.stock) || 0,
      unit: p.unit || 'cái',
    })),
    inStockVariants: inStockVariants.map(v => ({
      id: v.id,
      name: getFullDisplayName(v),
      sku: v.sku || '',
      stock: Number(v.stock) || 0,
      unit: v.unit || 'cái',
    })),
  };
}

/**
 * Xây dựng các khối tin nhắn HTML Telegram theo yêu cầu
 */
function buildTelegramAuditMessages(auditData, user = '', options = {}) {
  const { maxPerSection = DEFAULT_LIST_LIMIT } = options;
  const { stats, negativeProducts, lowStockProducts, abundantParents, inStockVariants } = auditData;
  const timestamp = formatTimestamp(stats.generatedAt);
  const messagesToSend = [];

  // ==========================================
  // TIN NHẮN 1: TỔNG QUAN & CẢNH BÁO NHẬP HÀNG KHẨN
  // ==========================================
  const overviewLines = [
    `🏭 <b>[BOT KHO HÀNG - BÁO CÁO KIỂM KHO TOÀN DIỆN]</b>`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `🚨 <b>CẢNH BÁO NHẬP HÀNG:</b>`,
    `⚠️ Phát hiện <b>${stats.negativeCount.toLocaleString('vi-VN')}</b> sản phẩm đang bị <b>ÂM KHO</b> và <b>${stats.lowStockCount.toLocaleString('vi-VN')}</b> sản phẩm <b>CÒN ÍT / SẮP HẾT HÀNG</b>!`,
    `👉 <b>CẢNH BÁO: SẢN PHẨM CÒN ÍT VÀ ÂM KHO VUI LÒNG NHẬP HÀNG!</b>`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `📊 <b>TỔNG QUAN TỒN KHO:</b>`,
    `📦 Tổng dòng tồn kho: <b>${stats.totalRows.toLocaleString('vi-VN')}</b>`,
    `🟢 Tổng tồn kho SP cha: <b>${formatStock(stats.totalParentStock)}</b>`,
    `🟣 Tổng biến thể: <b>${stats.totalVariantsCount.toLocaleString('vi-VN')}</b> (Tồn kho: <b>${formatStock(stats.totalVariantStock)}</b>)`,
    `📈 <b>TỔNG TỒN KHO TOÀN BỘ:</b> <b>${formatStock(stats.totalCombinedStock)}</b>`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `🔴 <b>Sản phẩm âm kho:</b> <b>${stats.negativeCount.toLocaleString('vi-VN')}</b> sản phẩm`,
    `🟡 <b>Sản phẩm còn ít (sắp hết):</b> <b>${stats.lowStockCount.toLocaleString('vi-VN')}</b> sản phẩm`,
    `🟢 <b>SP cha còn nhiều:</b> <b>${stats.abundantParentsCount.toLocaleString('vi-VN')}</b> sản phẩm`,
    `🟣 <b>Biến thể đang còn hàng:</b> <b>${stats.inStockVariantsCount.toLocaleString('vi-VN')}</b> sản phẩm`,
    user ? `👨‍💼 <b>Người yêu cầu:</b> ${escapeHtml(user)}` : null,
    `⏰ <i>Thời gian kiểm kho: ${timestamp}</i>`,
  ].filter(Boolean);

  messagesToSend.push(overviewLines.join('\n'));

  // ==========================================
  // TIN NHẮN 2: DANH SÁCH SẢN PHẨM ÂM KHO & CÒN ÍT (CẢNH BÁO NHẬP HÀNG)
  // ==========================================
  const warningListLines = [
    `🚨 <b>[CẢNH BÁO: SẢN PHẨM CÒN ÍT & ÂM KHO - VUI LÒNG NHẬP HÀNG]</b>`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
  ];

  if (negativeProducts.length > 0) {
    warningListLines.push(`🔴 <b>SẢN PHẨM ÂM KHO (${negativeProducts.length.toLocaleString('vi-VN')} mặt hàng):</b>`);
    const displayNeg = negativeProducts.slice(0, maxPerSection);
    displayNeg.forEach((p, idx) => {
      const skuText = p.sku ? ` <code>[${escapeHtml(p.sku)}]</code>` : '';
      warningListLines.push(`${idx + 1}. <b>${escapeHtml(p.name)}</b>${skuText}: <code>${formatStock(p.stock)} ${escapeHtml(p.unit)}</code>`);
    });
    if (negativeProducts.length > maxPerSection) {
      warningListLines.push(`<i>... và còn <b>${(negativeProducts.length - maxPerSection).toLocaleString('vi-VN')}</b> sản phẩm âm kho khác.</i>`);
    }
    warningListLines.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  } else {
    warningListLines.push(`✅ <i>Hiện tại không có sản phẩm nào bị âm kho.</i>\n━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  }

  if (lowStockProducts.length > 0) {
    warningListLines.push(`🟡 <b>SẢN PHẨM CÒN ÍT / SẮP HẾT (${lowStockProducts.length.toLocaleString('vi-VN')} mặt hàng):</b>`);
    const displayLow = lowStockProducts.slice(0, maxPerSection);
    displayLow.forEach((p, idx) => {
      const skuText = p.sku ? ` <code>[${escapeHtml(p.sku)}]</code>` : '';
      warningListLines.push(`${idx + 1}. <b>${escapeHtml(p.name)}</b>${skuText}: <b>${formatStock(p.stock)} ${escapeHtml(p.unit)}</b>`);
    });
    if (lowStockProducts.length > maxPerSection) {
      warningListLines.push(`<i>... và còn <b>${(lowStockProducts.length - maxPerSection).toLocaleString('vi-VN')}</b> sản phẩm còn ít khác.</i>`);
    }
  } else {
    warningListLines.push(`✅ <i>Không có sản phẩm nào có tồn kho dưới 10.</i>`);
  }

  warningListLines.push(`\n👉 <b>LƯU Ý:</b> CẢNH BÁO SẢN PHẨM CÒN ÍT VÀ ÂM KHO VUI LÒNG NHẬP HÀNG!`);
  messagesToSend.push(warningListLines.join('\n'));

  // ==========================================
  // TIN NHẮN 3: SẢN PHẨM CHA CÒN NHIỀU & BIẾN THỂ CÒN HÀNG
  // ==========================================
  const stockListLines = [
    `📦 <b>[DANH SÁCH SẢN PHẨM CÒN HÀNG TRONG KHO]</b>`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
  ];

  if (abundantParents.length > 0) {
    stockListLines.push(`🟢 <b>SẢN PHẨM CHA CÒN NHIỀU (${abundantParents.length.toLocaleString('vi-VN')} mặt hàng):</b>`);
    const displayParents = abundantParents.slice(0, maxPerSection);
    displayParents.forEach((p, idx) => {
      const skuText = p.sku ? ` <code>[${escapeHtml(p.sku)}]</code>` : '';
      stockListLines.push(`${idx + 1}. <b>${escapeHtml(p.name)}</b>${skuText}: <b>${formatStock(p.stock)} ${escapeHtml(p.unit)}</b>`);
    });
    if (abundantParents.length > maxPerSection) {
      stockListLines.push(`<i>... và còn <b>${(abundantParents.length - maxPerSection).toLocaleString('vi-VN')}</b> sản phẩm cha khác.</i>`);
    }
    stockListLines.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  }

  if (inStockVariants.length > 0) {
    stockListLines.push(`🟣 <b>SẢN PHẨM BIẾN THỂ (${inStockVariants.length.toLocaleString('vi-VN')} mặt hàng):</b>`);
    const displayVariants = inStockVariants.slice(0, maxPerSection);
    displayVariants.forEach((v, idx) => {
      const skuText = v.sku ? ` <code>[${escapeHtml(v.sku)}]</code>` : '';
      stockListLines.push(`${idx + 1}. <b>${escapeHtml(v.name)}</b>${skuText}: <b>${formatStock(v.stock)} ${escapeHtml(v.unit)}</b>`);
    });
    if (inStockVariants.length > maxPerSection) {
      stockListLines.push(`<i>... và còn <b>${(inStockVariants.length - maxPerSection).toLocaleString('vi-VN')}</b> biến thể khác.</i>`);
    }
  } else {
    stockListLines.push(`<i>Chưa có biến thể nào còn tồn kho.</i>`);
  }

  stockListLines.push(`\n<i>Xem đầy đủ báo cáo tại mục Kho hàng trên ứng dụng POS.</i>`);
  messagesToSend.push(stockListLines.join('\n'));

  return messagesToSend;
}

/**
 * Thực hiện kiểm tra kho và gửi toàn bộ báo cáo qua Telegram (Bot Kho hàng)
 */
async function sendInventoryAuditTelegramReport(options = {}) {
  const { user = 'Hệ thống POS', maxPerSection = DEFAULT_LIST_LIMIT } = options;
  const auditData = buildInventoryAuditData();

  const settings = getTelegramSettings();
  if (!settings.enabled) {
    return {
      ok: false,
      error: 'Tính năng thông báo Telegram đang tắt. Vui lòng bật trong menu Cài đặt hệ thống > Cấu hình 12 Bot Telegram.',
      stats: auditData.stats,
    };
  }

  if (!settings.group_id) {
    return {
      ok: false,
      error: 'Chưa cấu hình ID Nhóm Telegram (Group Chat ID). Vui lòng cài đặt ID nhóm nhận thông báo.',
      stats: auditData.stats,
    };
  }

  const botCfg = settings.bots?.bot_inventory;
  if (!botCfg || !botCfg.enabled || !botCfg.token) {
    return {
      ok: false,
      error: 'Chưa cấu hình hoặc chưa bật Token cho Bot Kho hàng (bot_inventory). Vui lòng kiểm tra lại trong Cài đặt Telegram.',
      stats: auditData.stats,
    };
  }

  const messages = buildTelegramAuditMessages(auditData, user, { maxPerSection });
  const results = [];

  for (let i = 0; i < messages.length; i++) {
    const htmlText = messages[i];
    const res = await sendRawTelegramMessage(botCfg.token, settings.group_id, htmlText);
    results.push(res);
    if (!res.ok) {
      console.warn(`[TELEGRAM bot_inventory] Gửi tin nhắn ${i + 1}/${messages.length} thất bại:`, res.error);
    }
    // Nghỉ 350ms giữa các tin nhắn để tuân thủ Telegram API rate limit
    if (i < messages.length - 1) {
      await sleep(350);
    }
  }

  const failedCount = results.filter(r => !r.ok).length;
  const successCount = results.length - failedCount;

  if (successCount === 0) {
    const firstErr = results[0]?.error || 'Không gửi được tin nhắn nào tới Telegram.';
    return {
      ok: false,
      error: firstErr,
      stats: auditData.stats,
      totalMessages: messages.length,
      successCount: 0,
    };
  }

  return {
    ok: true,
    message: `Đã gửi báo cáo kiểm kho về Telegram thành công (${successCount}/${messages.length} tin nhắn)!`,
    stats: auditData.stats,
    totalMessages: messages.length,
    successCount,
    failedCount,
  };
}

/**
 * Lắng nghe lệnh trực tiếp từ Telegram (/kiemkho, /tonkho, /kho) và nút bấm mở rộng chi tiết sản phẩm
 */
function startTelegramInventoryBotListener() {
  const { startTelegramBotListener } = require('./telegramService');
  startTelegramBotListener();
}

module.exports = {
  buildInventoryAuditData,
  buildTelegramAuditMessages,
  sendInventoryAuditTelegramReport,
  startTelegramInventoryBotListener,
};
