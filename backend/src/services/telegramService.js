const fs = require('fs');
const path = require('path');
const { getDb, withAtomicDbWrite, now } = require('../db/database');

const TELEGRAM_CONFIG_SETTING_KEY = 'telegram_config';
const LOCAL_CONFIG_FILE = path.resolve(__dirname, '..', '..', 'data', 'telegram_config.json');

const BOT_DEFINITIONS = [
  {
    key: 'bot_create_order',
    name: 'Bot Tạo đơn hàng',
    menuGroup: 'don_hang',
    description: 'Báo cáo ngay khi có đơn hàng mới được tạo',
    icon: 'PlusCircle',
  },
  {
    key: 'bot_order_list',
    name: 'Bot Danh sách đơn hàng',
    menuGroup: 'don_hang',
    description: 'Báo cáo khi sửa đơn, đổi trạng thái, hủy hoặc xóa đơn hàng',
    icon: 'FileText',
  },
  {
    key: 'bot_products',
    name: 'Bot Sản phẩm',
    menuGroup: 'danh_muc',
    description: 'Báo cáo khi thêm, sửa giá/thông tin, hoặc xóa sản phẩm',
    icon: 'Box',
  },
  {
    key: 'bot_inventory',
    name: 'Bot Kho hàng',
    menuGroup: 'danh_muc',
    description: 'Báo cáo biến động tồn kho, kiểm kho, cảnh báo hết hàng/âm kho',
    icon: 'Warehouse',
  },
  {
    key: 'bot_customers',
    name: 'Bot Khách hàng',
    menuGroup: 'danh_muc',
    description: 'Báo cáo khi thêm mới khách hàng, sửa thông tin, đổi công nợ',
    icon: 'Users',
  },
  {
    key: 'bot_imports',
    name: 'Bot Nhập hàng',
    menuGroup: 'danh_muc',
    description: 'Báo cáo khi lập phiếu nhập hàng mới, hủy hoặc cập nhật phiếu nhập',
    icon: 'ShoppingCart',
  },
  {
    key: 'bot_partners',
    name: 'Bot Đối Tác',
    menuGroup: 'danh_muc',
    description: 'Báo cáo khi thêm mới hoặc cập nhật thông tin nhà cung cấp / đối tác',
    icon: 'Truck',
  },
  {
    key: 'bot_stats',
    name: 'Bot Thống kê',
    menuGroup: 'quan_ly',
    description: 'Báo cáo doanh thu, số lượng đơn, lợi nhuận tổng hợp',
    icon: 'BarChart3',
  },
  {
    key: 'bot_cashbook',
    name: 'Bot Sổ quỹ',
    menuGroup: 'quan_ly',
    description: 'Báo cáo khi lập phiếu thu, phiếu chi, biến động số dư tiền mặt/ngân hàng',
    icon: 'Wallet',
  },
  {
    key: 'bot_order_reports',
    name: 'Bot Báo cáo theo đơn hàng',
    menuGroup: 'quan_ly',
    description: 'Báo cáo phân tích doanh thu chi tiết theo từng đơn hàng',
    icon: 'FileText',
  },
  {
    key: 'bot_product_reports',
    name: 'Bot Báo cáo sản phẩm',
    menuGroup: 'quan_ly',
    description: 'Báo cáo top sản phẩm bán chạy, sản phẩm tồn kho, doanh số từng món',
    icon: 'Boxes',
  },
  {
    key: 'bot_top_customers',
    name: 'Bot Top khách hàng',
    menuGroup: 'quan_ly',
    description: 'Báo cáo bảng xếp hạng khách hàng VIP chi tiêu cao nhất',
    icon: 'Trophy',
  },
];

function buildDefaultConfig() {
  const bots = {};
  for (const bot of BOT_DEFINITIONS) {
    bots[bot.key] = {
      token: '',
      enabled: true,
      name: bot.name,
    };
  }
  return {
    enabled: false,
    group_id: '',
    bots,
  };
}

let cachedSettings = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 10000;

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatVnd(amount) {
  const num = Number(amount || 0);
  return `${num.toLocaleString('vi-VN')} đ`;
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

function readSettingsFromDb() {
  try {
    const db = getDb();
    const row = (db.system_settings || []).find(
      s => s && (s.key === TELEGRAM_CONFIG_SETTING_KEY || s.setting_key === TELEGRAM_CONFIG_SETTING_KEY) && !s.deleted_at
    );
    if (row && row.value) {
      const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
      return parsed;
    }
  } catch (err) {
    console.warn('[TELEGRAM] Lỗi đọc system_settings:', err.message);
  }
  return null;
}

function readSettingsFromFile() {
  try {
    if (fs.existsSync(LOCAL_CONFIG_FILE)) {
      const data = fs.readFileSync(LOCAL_CONFIG_FILE, 'utf8');
      if (data) return JSON.parse(data);
    }
  } catch (err) {
    console.warn('[TELEGRAM] Lỗi đọc file config cục bộ:', err.message);
  }
  return null;
}

function getTelegramSettings() {
  const nowMs = Date.now();
  if (cachedSettings && nowMs - lastCacheTime < CACHE_TTL_MS) {
    return cachedSettings;
  }

  const defaultCfg = buildDefaultConfig();
  const dbCfg = readSettingsFromDb();
  const fileCfg = readSettingsFromFile();
  const merged = {
    ...defaultCfg,
    ...(fileCfg || {}),
    ...(dbCfg || {}),
  };

  // Ensure all 12 bots exist
  merged.bots = merged.bots || {};
  for (const bot of BOT_DEFINITIONS) {
    merged.bots[bot.key] = {
      token: String(merged.bots[bot.key]?.token || '').trim(),
      enabled: merged.bots[bot.key]?.enabled !== false,
      name: bot.name,
    };
  }
  merged.enabled = Boolean(merged.enabled);
  merged.group_id = String(merged.group_id || '').trim();

  cachedSettings = merged;
  lastCacheTime = nowMs;
  return merged;
}

function saveTelegramSettings(input = {}) {
  const current = getTelegramSettings();
  const next = {
    ...current,
    enabled: typeof input.enabled === 'boolean' ? input.enabled : current.enabled,
    group_id: input.group_id !== undefined ? String(input.group_id || '').trim() : current.group_id,
    bots: { ...(current.bots || {}) },
  };

  if (input.bots && typeof input.bots === 'object') {
    for (const bot of BOT_DEFINITIONS) {
      if (input.bots[bot.key]) {
        next.bots[bot.key] = {
          token: String(input.bots[bot.key].token ?? next.bots[bot.key]?.token ?? '').trim(),
          enabled: input.bots[bot.key].enabled !== undefined ? Boolean(input.bots[bot.key].enabled) : next.bots[bot.key]?.enabled !== false,
          name: bot.name,
        };
      }
    }
  }

  // Write to database
  try {
    withAtomicDbWrite(() => {
      const db = getDb();
      db.system_settings = db.system_settings || [];
      const existing = db.system_settings.find(
        s => s && (s.key === TELEGRAM_CONFIG_SETTING_KEY || s.setting_key === TELEGRAM_CONFIG_SETTING_KEY) && !s.deleted_at
      );
      const jsonStr = JSON.stringify(next);
      if (existing) {
        existing.value = jsonStr;
        existing.updated_at = now();
      } else {
        const id = (db.nextId && db.nextId.system_settings) ? db.nextId.system_settings++ : db.system_settings.length + 1;
        db.system_settings.push({
          id,
          key: TELEGRAM_CONFIG_SETTING_KEY,
          value: jsonStr,
          value_type: 'json',
          category: 'integrations',
          description: 'Cấu hình 12 Bot Telegram báo cáo biến động phần mềm',
          created_at: now(),
          updated_at: now(),
        });
      }
    });
  } catch (err) {
    console.warn('[TELEGRAM] Lỗi lưu system_settings:', err.message);
  }

  // Also write to local file as persistent backup
  try {
    const dir = path.dirname(LOCAL_CONFIG_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(LOCAL_CONFIG_FILE, JSON.stringify(next, null, 2), 'utf8');
  } catch (err) {
    console.warn('[TELEGRAM] Lỗi lưu file config cục bộ:', err.message);
  }

  cachedSettings = next;
  lastCacheTime = Date.now();
  return next;
}

async function sendRawTelegramMessage(token, chatId, textHtml, attempt = 1) {
  if (!token || !chatId || !textHtml) {
    return { ok: false, error: 'Thiếu token, chat_id hoặc nội dung tin nhắn.' };
  }

  const cleanToken = String(token).trim();
  const cleanChatId = String(chatId).trim();
  const url = `https://api.telegram.org/bot${cleanToken}/sendMessage`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: cleanChatId,
        text: textHtml,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const data = await response.json().catch(() => null);
    if (data && data.ok) {
      return { ok: true, result: data.result };
    }

    // Nếu Telegram báo lỗi entity parsing HTML, tự động gửi lại bằng plain-text
    const description = String(data?.description || '');
    if (description.includes("can't parse entities") || description.includes('entity') || description.includes('Bad Request')) {
      try {
        const plainText = String(textHtml).replace(/<[^>]+>/g, '').trim();
        const retryController = new AbortController();
        const retryTimeout = setTimeout(() => retryController.abort(), 8000);
        const retryRes = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: cleanChatId,
            text: plainText,
            disable_web_page_preview: true,
          }),
          signal: retryController.signal,
        });
        clearTimeout(retryTimeout);
        const retryData = await retryRes.json().catch(() => null);
        if (retryData && retryData.ok) {
          return { ok: true, result: retryData.result };
        }
      } catch (retryErr) {
        // bỏ qua để trả về description gốc
      }
    }

    return {
      ok: false,
      error: data?.description || `HTTP ${response.status}: Lỗi từ Telegram API.`,
      code: data?.error_code,
    };
  } catch (err) {
    if (attempt <= 1) {
      // Thử lại 1 lần sau 1.2s nếu timeout hoặc gián đoạn mạng
      await new Promise(r => setTimeout(r, 1200));
      return sendRawTelegramMessage(token, chatId, textHtml, attempt + 1);
    }
    if (err.name === 'AbortError') {
      return { ok: false, error: 'Quá thời gian kết nối (timeout 8s) tới Telegram API.' };
    }
    return { ok: false, error: err.message || 'Lỗi mạng hoặc không thể kết nối tới Telegram.' };
  }
}

async function testSingleBot(botKey, overrideToken = '', overrideGroupId = '') {
  const settings = getTelegramSettings();
  const def = BOT_DEFINITIONS.find(b => b.key === botKey) || { name: botKey };
  const token = (overrideToken || settings.bots?.[botKey]?.token || '').trim();
  const groupId = (overrideGroupId || settings.group_id || '').trim();

  if (!token) {
    return { ok: false, error: `Chưa cấu hình Token cho [${def.name}].` };
  }
  if (!groupId) {
    return { ok: false, error: 'Chưa cấu hình ID Nhóm Telegram (Group Chat ID).' };
  }

  const testMessage = [
    `🤖 <b>[${escapeHtml(def.name)}] - THỬ NGHIỆM KẾT NỐI</b>`,
    `━━━━━━━━━━━━━━━━━━`,
    `✅ <b>Trạng thái:</b> Kết nối thành công!`,
    `💬 <b>Nhóm nhận:</b> <code>${escapeHtml(groupId)}</code>`,
    `⏰ <b>Thời gian:</b> ${formatTimestamp()}`,
    `🏢 <b>Hệ thống:</b> Bán Hàng POS Offline`,
    `📌 <i>Bot đã sẵn sàng gửi thông báo tự động khi có biến động!</i>`,
  ].join('\n');

  const result = await sendRawTelegramMessage(token, groupId, testMessage);
  return {
    botKey,
    botName: def.name,
    ...result,
  };
}

async function testAllBots(overrideGroupId = '') {
  const settings = getTelegramSettings();
  const groupId = (overrideGroupId || settings.group_id || '').trim();
  if (!groupId) {
    return { ok: false, error: 'Chưa cấu hình ID Nhóm Telegram (Group Chat ID).' };
  }

  const results = [];
  for (const bot of BOT_DEFINITIONS) {
    const botCfg = settings.bots?.[bot.key];
    if (!botCfg || !botCfg.token) {
      results.push({
        botKey: bot.key,
        botName: bot.name,
        ok: false,
        error: 'Chưa nhập token',
        skipped: true,
      });
      continue;
    }
    const res = await testSingleBot(bot.key, botCfg.token, groupId);
    results.push(res);
  }

  const successCount = results.filter(r => r.ok).length;
  const configuredCount = results.filter(r => !r.skipped).length;

  return {
    ok: successCount > 0,
    summary: `Kiểm tra xong: ${successCount}/${configuredCount} bot hoạt động tốt (Tổng 12 bot).`,
    results,
  };
}

// ─────────────────────────────────────────────────────────────
// Formatters cho 12 nghiệp vụ tương ứng
// ─────────────────────────────────────────────────────────────

function formatCreateOrderMessage(data = {}) {
  const inv = data.invoice || data;
  const items = Array.isArray(inv.details) ? inv.details : [];
  const total = Number(inv.total) || 0;
  const oldDebt = Number(inv.old_debt) || 0;
  const paid = Number(inv.paid_amount) || 0;
  const payable = Math.max(0, total + oldDebt - paid);

  const lines = [
    `🛒 <b>[TẠO ĐƠN HÀNG MỚI]</b>`,
    `━━━━━━━━━━━━━━━━━━`,
    `🔖 <b>Mã đơn:</b> <code>#${escapeHtml(inv.invoice_code || inv.id || 'N/A')}</code>`,
    `👤 <b>Khách hàng:</b> <b>${escapeHtml(inv.customer_name || 'Khách lẻ')}</b>${inv.customer_phone ? ` (${escapeHtml(inv.customer_phone)})` : ''}`,
    `💵 <b>Khách cần trả (tiền đơn):</b> <b>${formatVnd(total)}</b>`,
  ];

  if (oldDebt > 0) {
    lines.push(`💳 <b>Nợ cũ:</b> <code>+${formatVnd(oldDebt)}</code>`);
  }

  if (paid > 0) {
    lines.push(`💰 <b>Đã thu:</b> <b>${formatVnd(paid)}</b>`);
  }

  lines.push(`🔥 <b>Thành tiền cần thanh toán:</b> <b>${formatVnd(payable)}</b>`);
  lines.push(`💳 <b>Hình thức:</b> ${escapeHtml(inv.payment_method || 'Tiền mặt')}`);

  if (items.length > 0) {
    lines.push(`📦 <b>Chi tiết sản phẩm (${items.length} món):</b>`);
    const previewItems = items.slice(0, 8);
    for (const item of previewItems) {
      const name = item.product_name || item.name || 'Sản phẩm';
      const qty = item.quantity || item.qty || 1;
      const price = item.line_total || item.total || (qty * (item.unit_price || item.price || 0));
      lines.push(` • ${escapeHtml(name)} x${qty} (${formatVnd(price)})`);
    }
    if (items.length > 8) {
      lines.push(` • <i>...và ${items.length - 8} mặt hàng khác</i>`);
    }
  }

  if (inv.note) lines.push(`📝 <b>Ghi chú:</b> ${escapeHtml(inv.note)}`);
  lines.push(`⏰ <b>Thời gian:</b> ${formatTimestamp(inv.created_at)}`);
  if (inv.invoice_writer || data.creator) lines.push(`👨‍💼 <b>Nhân viên:</b> ${escapeHtml(inv.invoice_writer || data.creator)}`);

  return lines.join('\n');
}

function formatOrderListMessage(data = {}) {
  const {
    action = 'Cập nhật',
    invoice = {},
    previousStatus = '',
    newStatus = '',
    note = '',
    user = '',
    details = [],
  } = data;

  const total = Number(invoice.total) || 0;
  const oldDebt = Number(invoice.old_debt) || 0;
  const paid = Number(invoice.paid_amount) || 0;
  const payable = Math.max(0, total + oldDebt - paid);

  let icon = '📋';
  if (action.includes('Hủy') || action.includes('hủy')) icon = '🗑️';
  else if (action.includes('Thanh toán') || action.includes('thanh toán')) icon = '✅';
  else if (action.includes('In') || action.includes('in')) icon = '🖨️';
  else if (action.includes('Sửa') || action.includes('sửa')) icon = '✏️';

  const lines = [
    `${icon} <b>[DANH SÁCH ĐƠN HÀNG - ${escapeHtml(action.toUpperCase())}]</b>`,
    `━━━━━━━━━━━━━━━━━━`,
    `🔖 <b>Mã đơn:</b> <code>#${escapeHtml(invoice.invoice_code || invoice.id || 'N/A')}</code>`,
    `👤 <b>Khách hàng:</b> <b>${escapeHtml(invoice.customer_name || 'Khách lẻ')}</b>`,
    `💵 <b>Tiền đơn hàng:</b> <b>${formatVnd(total)}</b>`,
  ];

  if (oldDebt > 0) {
    lines.push(`💳 <b>Nợ cũ:</b> +${formatVnd(oldDebt)}`);
  }
  if (paid > 0) {
    lines.push(`💰 <b>Đã thu:</b> ${formatVnd(paid)}`);
  }
  if (oldDebt > 0 || paid > 0) {
    lines.push(`🔥 <b>Thành tiền cần thanh toán:</b> <b>${formatVnd(payable)}</b>`);
  }

  if (previousStatus && newStatus && previousStatus !== newStatus) {
    lines.push(`🔄 <b>Trạng thái:</b> <code>${escapeHtml(previousStatus)}</code> ➔ <b>${escapeHtml(newStatus)}</b>`);
  } else if (newStatus || invoice.status) {
    lines.push(`📌 <b>Trạng thái:</b> <b>${escapeHtml(newStatus || invoice.status)}</b>`);
  }

  const items = Array.isArray(details) && details.length > 0 ? details : (Array.isArray(invoice.details) ? invoice.details : []);
  if (items.length > 0) {
    lines.push(`📦 <b>Chi tiết (${items.length} món):</b>`);
    for (const item of items.slice(0, 5)) {
      lines.push(` • ${escapeHtml(item.product_name || item.name || 'SP')} x${item.quantity || 1} (${formatVnd(item.line_total || item.total || 0)})`);
    }
    if (items.length > 5) {
      lines.push(` • <i>...và ${items.length - 5} mặt hàng khác</i>`);
    }
  }

  if (note) lines.push(`📝 <b>Chi tiết:</b> ${escapeHtml(note)}`);
  if (user) lines.push(`👨‍💼 <b>Người thực hiện:</b> ${escapeHtml(user)}`);
  lines.push(`⏰ <b>Thời gian:</b> ${formatTimestamp()}`);

  return lines.join('\n');
}

function formatProductMessage(data = {}) {
  const { action = 'Cập nhật', product = {}, user = '' } = data;
  const lines = [
    `📦 <b>[SẢN PHẨM - ${escapeHtml(action.toUpperCase())}]</b>`,
    `━━━━━━━━━━━━━━━━━━`,
    `🏷️ <b>Tên sản phẩm:</b> <b>${escapeHtml(product.name || 'Không rõ')}</b>`,
    product.sku ? `🔢 <b>Mã SKU:</b> <code>${escapeHtml(product.sku)}</code>` : null,
    product.barcode ? `📊 <b>Barcode:</b> <code>${escapeHtml(product.barcode)}</code>` : null,
    `💵 <b>Giá bán lẻ:</b> ${formatVnd(product.retail_price || product.price || 0)}`,
    product.cost_price ? `🏷️ <b>Giá vốn:</b> ${formatVnd(product.cost_price)}` : null,
    product.stock !== undefined ? `📦 <b>Tồn kho hiện tại:</b> ${product.stock} ${escapeHtml(product.unit || '')}` : null,
    user ? `👨‍💼 <b>Người thao tác:</b> ${escapeHtml(user)}` : null,
    `⏰ <b>Thời gian:</b> ${formatTimestamp()}`,
  ].filter(Boolean);

  return lines.join('\n');
}

function formatInventoryMessage(data = {}) {
  const { action = 'Biến động kho', product = {}, change = 0, oldStock = 0, newStock = 0, reason = '', user = '' } = data;
  const lines = [
    `🏭 <b>[KHO HÀNG - ${escapeHtml(action.toUpperCase())}]</b>`,
    `━━━━━━━━━━━━━━━━━━`,
    `🏷️ <b>Sản phẩm:</b> <b>${escapeHtml(product.name || data.product_name || 'Không rõ')}</b>`,
    product.sku ? `🔢 <b>Mã SKU:</b> <code>${escapeHtml(product.sku)}</code>` : null,
    `🔄 <b>Thay đổi:</b> ${change > 0 ? `+${change}` : change} ${escapeHtml(product.unit || '')}`,
    `📊 <b>Tồn kho:</b> ${oldStock} ➔ <b>${newStock}</b> ${escapeHtml(product.unit || '')}`,
    reason ? `📝 <b>Lý do:</b> ${escapeHtml(reason)}` : null,
    newStock <= 5 ? `⚠️ <b>CẢNH BÁO:</b> Tồn kho sắp hết!` : null,
    newStock < 0 ? `🚨 <b>CẢNH BÁO:</b> Sản phẩm đang bị XUẤT ÂM TỒN KHO!` : null,
    user ? `👨‍💼 <b>Người thực hiện:</b> ${escapeHtml(user)}` : null,
    `⏰ <b>Thời gian:</b> ${formatTimestamp()}`,
  ].filter(Boolean);

  return lines.join('\n');
}

function formatCustomerMessage(data = {}) {
  const { action = 'Thêm mới', customer = {}, user = '' } = data;
  const lines = [
    `👥 <b>[KHÁCH HÀNG - ${escapeHtml(action.toUpperCase())}]</b>`,
    `━━━━━━━━━━━━━━━━━━`,
    `👤 <b>Tên khách hàng:</b> <b>${escapeHtml(customer.name || 'Không rõ')}</b>`,
    customer.phone ? `📞 <b>Số điện thoại:</b> ${escapeHtml(customer.phone)}` : null,
    customer.address ? `📍 <b>Địa chỉ:</b> ${escapeHtml(customer.address)}` : null,
    customer.debt !== undefined ? `💳 <b>Công nợ hiện tại:</b> ${formatVnd(customer.debt)}` : null,
    customer.customer_type ? `🏷️ <b>Nhóm khách:</b> ${escapeHtml(customer.customer_type)}` : null,
    user ? `👨‍💼 <b>Nhân viên:</b> ${escapeHtml(user)}` : null,
    `⏰ <b>Thời gian:</b> ${formatTimestamp()}`,
  ].filter(Boolean);

  return lines.join('\n');
}

function formatImportMessage(data = {}) {
  const { action = 'Tạo phiếu nhập', importData = {}, user = '' } = data;
  const items = Array.isArray(importData.items || importData.details) ? (importData.items || importData.details) : [];
  const lines = [
    `📥 <b>[NHẬP HÀNG - ${escapeHtml(action.toUpperCase())}]</b>`,
    `━━━━━━━━━━━━━━━━━━`,
    `🔖 <b>Mã phiếu nhập:</b> <code>#${escapeHtml(importData.code || importData.id || 'N/A')}</code>`,
    importData.supplier_name || importData.partner_name ? `🏭 <b>Nhà cung cấp:</b> ${escapeHtml(importData.supplier_name || importData.partner_name)}` : null,
    `💰 <b>Tổng tiền hàng:</b> <b>${formatVnd(importData.total || importData.total_amount || 0)}</b>`,
    importData.paid_amount !== undefined ? `💵 <b>Đã thanh toán:</b> ${formatVnd(importData.paid_amount)}` : null,
    importData.debt_amount !== undefined ? `💳 <b>Còn nợ NCC:</b> ${formatVnd(importData.debt_amount)}` : null,
    items.length > 0 ? `📦 <b>Số lượng:</b> ${items.length} mặt hàng` : null,
    importData.note ? `📝 <b>Ghi chú:</b> ${escapeHtml(importData.note)}` : null,
    user ? `👨‍💼 <b>Người lập:</b> ${escapeHtml(user)}` : null,
    `⏰ <b>Thời gian:</b> ${formatTimestamp()}`,
  ].filter(Boolean);

  return lines.join('\n');
}

function formatPartnerMessage(data = {}) {
  const { action = 'Cập nhật', partner = {}, user = '' } = data;
  const lines = [
    `🚚 <b>[ĐỐI TÁC / NHÀ CUNG CẤP - ${escapeHtml(action.toUpperCase())}]</b>`,
    `━━━━━━━━━━━━━━━━━━`,
    `🏢 <b>Tên đối tác:</b> <b>${escapeHtml(partner.name || 'Không rõ')}</b>`,
    partner.phone ? `📞 <b>Số điện thoại:</b> ${escapeHtml(partner.phone)}` : null,
    partner.address ? `📍 <b>Địa chỉ:</b> ${escapeHtml(partner.address)}` : null,
    partner.tax_code ? `🧾 <b>Mã số thuế:</b> ${escapeHtml(partner.tax_code)}` : null,
    partner.debt !== undefined ? `💳 <b>Công nợ:</b> ${formatVnd(partner.debt)}` : null,
    user ? `👨‍💼 <b>Người thực hiện:</b> ${escapeHtml(user)}` : null,
    `⏰ <b>Thời gian:</b> ${formatTimestamp()}`,
  ].filter(Boolean);

  return lines.join('\n');
}

function formatStatsMessage(data = {}) {
  const { period = 'Hôm nay', revenue = 0, orderCount = 0, profit = 0, cost = 0, averageOrder = 0 } = data;
  const lines = [
    `📊 <b>[BÁO CÁO THỐNG KÊ DOANH THU]</b>`,
    `━━━━━━━━━━━━━━━━━━`,
    `📅 <b>Kỳ báo cáo:</b> ${escapeHtml(period)}`,
    `💰 <b>Tổng doanh thu:</b> <b>${formatVnd(revenue)}</b>`,
    `🧾 <b>Số lượng đơn hàng:</b> <b>${orderCount} đơn</b>`,
    averageOrder ? `🎯 <b>Giá trị TB / đơn (AOV):</b> ${formatVnd(averageOrder)}` : null,
    cost ? `🏷️ <b>Tiền vốn:</b> ${formatVnd(cost)}` : null,
    profit ? `📈 <b>Lợi nhuận gộp:</b> <b>${formatVnd(profit)}</b>` : null,
    `⏰ <b>Thời gian chốt:</b> ${formatTimestamp()}`,
  ].filter(Boolean);

  return lines.join('\n');
}

function formatCashbookMessage(data = {}) {
  const { action = 'Giao dịch mới', transaction = {}, user = '' } = data;
  const type = String(transaction.type || '').toLowerCase();
  const isIncome = type.includes('thu') || type === 'income' || Number(transaction.amount || 0) > 0;
  const lines = [
    `💰 <b>[SỔ QUỸ - ${isIncome ? 'PHIẾU THU 🟢' : 'PHIẾU CHI 🔴'}]</b>`,
    `━━━━━━━━━━━━━━━━━━`,
    transaction.code || transaction.id ? `🔖 <b>Mã phiếu:</b> <code>#${escapeHtml(transaction.code || transaction.id)}</code>` : null,
    `💵 <b>Số tiền:</b> <b>${formatVnd(Math.abs(transaction.amount || 0))}</b>`,
    transaction.category ? `📂 <b>Danh mục:</b> ${escapeHtml(transaction.category)}` : null,
    transaction.recipient_name || transaction.partner_name ? `👤 <b>Đối tượng:</b> ${escapeHtml(transaction.recipient_name || transaction.partner_name)}` : null,
    transaction.payment_method ? `💳 <b>Hình thức:</b> ${escapeHtml(transaction.payment_method)}` : null,
    transaction.note ? `📝 <b>Ghi chú:</b> ${escapeHtml(transaction.note)}` : null,
    user ? `👨‍💼 <b>Người lập:</b> ${escapeHtml(user)}` : null,
    `⏰ <b>Thời gian:</b> ${formatTimestamp()}`,
  ].filter(Boolean);

  return lines.join('\n');
}

function formatOrderReportsMessage(data = {}) {
  const { title = 'Báo cáo theo đơn hàng', period = 'Hôm nay', totalOrders = 0, completedOrders = 0, cancelledOrders = 0, totalAmount = 0 } = data;
  const lines = [
    `📑 <b>[BÁO CÁO THEO ĐƠN HÀNG]</b>`,
    `━━━━━━━━━━━━━━━━━━`,
    `📅 <b>Kỳ báo cáo:</b> ${escapeHtml(period)}`,
    `📦 <b>Tổng đơn:</b> ${totalOrders} đơn (Hoàn thành: ${completedOrders}, Đã hủy: ${cancelledOrders})`,
    `💰 <b>Doanh thu gộp:</b> <b>${formatVnd(totalAmount)}</b>`,
    data.note ? `📝 <b>Chi tiết:</b> ${escapeHtml(data.note)}` : null,
    `⏰ <b>Thời gian xuất:</b> ${formatTimestamp()}`,
  ].filter(Boolean);

  return lines.join('\n');
}

function formatProductReportsMessage(data = {}) {
  const { title = 'Báo cáo sản phẩm', period = 'Tháng này', topProducts = [] } = data;
  const lines = [
    `📦 <b>[BÁO CÁO SẢN PHẨM]</b>`,
    `━━━━━━━━━━━━━━━━━━`,
    `📅 <b>Kỳ báo cáo:</b> ${escapeHtml(period)}`,
  ];

  if (Array.isArray(topProducts) && topProducts.length > 0) {
    lines.push(`🏆 <b>Top sản phẩm nổi bật:</b>`);
    topProducts.slice(0, 5).forEach((p, idx) => {
      lines.push(`${idx + 1}. <b>${escapeHtml(p.name || p.product_name)}</b>: ${p.quantity || 0} cái - ${formatVnd(p.revenue || p.total || 0)}`);
    });
  }

  if (data.totalProductsCount) lines.push(`📊 <b>Tổng số mặt hàng:</b> ${data.totalProductsCount}`);
  lines.push(`⏰ <b>Thời gian xuất:</b> ${formatTimestamp()}`);

  return lines.join('\n');
}

function formatTopCustomersMessage(data = {}) {
  const { period = 'Toàn thời gian', topCustomers = [] } = data;
  const lines = [
    `🏆 <b>[BẢNG VÀNG TOP KHÁCH HÀNG]</b>`,
    `━━━━━━━━━━━━━━━━━━`,
    `📅 <b>Kỳ đánh giá:</b> ${escapeHtml(period)}`,
  ];

  if (Array.isArray(topCustomers) && topCustomers.length > 0) {
    const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
    topCustomers.slice(0, 5).forEach((c, idx) => {
      const medal = medals[idx] || `${idx + 1}.`;
      lines.push(`${medal} <b>${escapeHtml(c.name || c.customer_name)}</b>: ${c.order_count || c.invoices_count || 0} đơn - <b>${formatVnd(c.total_spent || c.total || 0)}</b>`);
    });
  } else {
    lines.push(`<i>Chưa có dữ liệu giao dịch của khách hàng.</i>`);
  }

  lines.push(`⏰ <b>Thời gian xuất:</b> ${formatTimestamp()}`);
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────
// Non-blocking notification dispatch
// ─────────────────────────────────────────────────────────────

function buildNotificationHtml(botKey, eventType, data = {}) {
  switch (botKey) {
    case 'bot_create_order':
      return formatCreateOrderMessage(data);
    case 'bot_order_list':
      return formatOrderListMessage(data);
    case 'bot_products':
      return formatProductMessage(data);
    case 'bot_inventory':
      return formatInventoryMessage(data);
    case 'bot_customers':
      return formatCustomerMessage(data);
    case 'bot_imports':
      return formatImportMessage(data);
    case 'bot_partners':
      return formatPartnerMessage(data);
    case 'bot_stats':
      return formatStatsMessage(data);
    case 'bot_cashbook':
      return formatCashbookMessage(data);
    case 'bot_order_reports':
      return formatOrderReportsMessage(data);
    case 'bot_product_reports':
      return formatProductReportsMessage(data);
    case 'bot_top_customers':
      return formatTopCustomersMessage(data);
    default:
      return [
        `🔔 <b>[THÔNG BÁO TỪ HỆ THỐNG]</b>`,
        `━━━━━━━━━━━━━━━━━━`,
        `<b>Sự kiện:</b> ${escapeHtml(eventType)}`,
        data.message ? `<b>Nội dung:</b> ${escapeHtml(data.message)}` : '',
        `⏰ <b>Thời gian:</b> ${formatTimestamp()}`,
      ].filter(Boolean).join('\n');
  }
}

/**
 * Tìm token bot phù hợp nhất:
 * 1. Dùng token riêng của bot được cấu hình
 * 2. Nếu bot đó chưa có token, tự động dùng token của bất kỳ bot nào khác đã được cấu hình trong hệ thống!
 * Giúp người dùng dù chỉ dán 1 token Telegram cho 1 bot bất kỳ thì TẤT CẢ các nghiệp vụ đều được thông báo.
 */
function resolveBotConfig(settings, botKey) {
  if (!settings || settings.enabled === false) return null;
  const groupId = String(settings.group_id || '').trim();
  if (!groupId) return null;

  // 1. Kiểm tra trực tiếp bot được chỉ định
  const botCfg = settings.bots?.[botKey];
  if (botCfg && botCfg.enabled !== false && botCfg.token && String(botCfg.token).trim()) {
    return {
      token: String(botCfg.token).trim(),
      name: botCfg.name || botKey,
      groupId,
      key: botKey,
    };
  }

  // 2. Kiểm tra token mặc định chung nếu có
  if (settings.default_token && String(settings.default_token).trim()) {
    return {
      token: String(settings.default_token).trim(),
      name: botCfg?.name || botKey,
      groupId,
      key: botKey,
    };
  }

  // 3. Fallback thông minh: Dùng token của bot bất kỳ đã nhập token và đang bật
  for (const [key, cfg] of Object.entries(settings.bots || {})) {
    if (cfg && cfg.enabled !== false && cfg.token && String(cfg.token).trim()) {
      return {
        token: String(cfg.token).trim(),
        name: botCfg?.name || cfg.name || botKey,
        groupId,
        key: botKey,
      };
    }
  }

  return null;
}

/**
 * Gửi thông báo Telegram hoàn toàn BẤT ĐỒNG BỘ KHÔNG CHẶN (fire-and-forget).
 * Mọi ngoại lệ mạng, token sai hoặc timeout đều được cô lập an toàn,
 * đảm bảo hệ thống POS offline không bao giờ bị đơ hay gián đoạn.
 */
function notifyTelegram(botKey, eventType, data = {}) {
  // Use setImmediate to defer execution off the current event loop turn
  setImmediate(async () => {
    try {
      const settings = getTelegramSettings();
      const resolved = resolveBotConfig(settings, botKey);
      if (!resolved || !resolved.token || !resolved.groupId) {
        return;
      }

      const html = buildNotificationHtml(botKey, eventType, data);
      const res = await sendRawTelegramMessage(resolved.token, resolved.groupId, html);
      if (!res.ok) {
        console.warn(`[TELEGRAM ${botKey}] Gửi thông báo không thành công:`, res.error);
      }
    } catch (err) {
      console.warn(`[TELEGRAM ${botKey}] Lỗi khi gửi thông báo:`, err.message);
    }
  });
}

module.exports = {
  BOT_DEFINITIONS,
  getTelegramSettings,
  saveTelegramSettings,
  sendRawTelegramMessage,
  testSingleBot,
  testAllBots,
  resolveBotConfig,
  notifyTelegram,
  formatCreateOrderMessage,
  formatOrderListMessage,
  formatProductMessage,
  formatInventoryMessage,
  formatCustomerMessage,
  formatImportMessage,
  formatPartnerMessage,
  formatStatsMessage,
  formatCashbookMessage,
  formatOrderReportsMessage,
  formatProductReportsMessage,
  formatTopCustomersMessage,
};
