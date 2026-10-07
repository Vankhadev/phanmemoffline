/**
 * Service Trí Tuệ Nhân Tạo Google Gemini cho Kế Toán Công Nợ (Bán Hàng Pos)
 * Giai đoạn 2: Tích hợp Gemini API Key, Phân tích nợ xấu, Hỏi đáp trợ lý AI, Tự soạn tin nhắn nhắc nợ
 */

const https = require('https');
const { getDb, withAtomicDbWrite, now, isCompletedInvoiceStatus } = require('../db/database');
const debtAgingService = require('./debtAgingService');

const GEMINI_CONFIG_SETTING_KEY = 'gemini_accounting_config';
const DEFAULT_MODEL = 'gemini-3.8-flash';
// Khóa Google Gemini API Key tích hợp sẵn theo phần mềm - người dùng không cần nhập key thủ công
const BUILTIN_DEFAULT_GEMINI_KEY = Buffer.from('QVEuQWI4Uk42Szh2a2tISFlqUkZDb2tuYWs5WmtPXzJ1SjA5MmRqWEFZQTlqXzJaSHRUZHc=', 'base64').toString('utf8');
const SUPPORTED_MODELS = [
  'gemini-3.8-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
  'gemini-3.5-flash-lite',
  'gemini-flash-lite-latest',
  'gemini-2.5-flash',
  'gemini-flash-latest',
  'gemini-pro-latest',
  'gemini-3.6-flash',
];

/**
 * Tự động chuẩn hóa các model cũ/deprecated sang model chuẩn mới nhất
 */
function normalizeModel(model) {
  if (!model) return DEFAULT_MODEL;
  const m = String(model).trim();
  if (m === 'gemini-1.0-pro' || m === 'gemini-pro') {
    return 'gemini-1.5-flash';
  }
  return m;
}

/**
 * Đọc cấu hình Gemini API từ Database, biến môi trường hoặc khóa tích hợp sẵn
 */
function getGeminiConfig() {
  let saved = {};
  try {
    const db = getDb();
    const row = (db.system_settings || []).find(
      s => s && (s.key === GEMINI_CONFIG_SETTING_KEY || s.setting_key === GEMINI_CONFIG_SETTING_KEY) && !s.deleted_at
    );
    if (row && row.value) {
      saved = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
    }
  } catch (err) {
    console.warn('[GEMINI AI] Lỗi đọc system_settings:', err.message);
  }

  const envKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '';
  const apiKey = String(saved.apiKey || envKey || BUILTIN_DEFAULT_GEMINI_KEY).trim();
  const rawModel = String(saved.model || process.env.GEMINI_MODEL || DEFAULT_MODEL).trim();
  const model = normalizeModel(SUPPORTED_MODELS.includes(rawModel) ? rawModel : DEFAULT_MODEL);
  const isBuiltinKey = apiKey === BUILTIN_DEFAULT_GEMINI_KEY;

  return {
    apiKey,
    model: SUPPORTED_MODELS.includes(model) ? model : DEFAULT_MODEL,
    temperature: Number(saved.temperature ?? 0.7),
    isConfigured: Boolean(apiKey && apiKey.length > 10),
    isBuiltinKey,
    maskedKey: maskApiKey(apiKey),
    updated_at: saved.updated_at || null,
  };
}

/**
 * Che API key để hiển thị an toàn trên giao diện
 */
function maskApiKey(key) {
  if (!key || typeof key !== 'string') return '';
  const trimmed = key.trim();
  if (trimmed.length <= 10) return '********';
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
}

/**
 * Lưu cấu hình Gemini API Key vào Database
 */
function saveGeminiConfig({ apiKey, model, temperature }) {
  const current = getGeminiConfig();
  const targetModel = normalizeModel(model && SUPPORTED_MODELS.includes(model) ? model : current.model);
  const resolvedApiKey = apiKey !== undefined
    ? (String(apiKey).trim() && String(apiKey).trim() !== 'reset' && String(apiKey).trim() !== 'default'
      ? String(apiKey).trim()
      : BUILTIN_DEFAULT_GEMINI_KEY)
    : (current.apiKey || BUILTIN_DEFAULT_GEMINI_KEY);

  const next = {
    apiKey: resolvedApiKey,
    model: targetModel,
    temperature: typeof temperature === 'number' ? Math.max(0, Math.min(1, temperature)) : current.temperature,
    updated_at: now(),
  };

  withAtomicDbWrite(() => {
    const db = getDb();
    db.system_settings = db.system_settings || [];
    const existing = db.system_settings.find(
      s => s && (s.key === GEMINI_CONFIG_SETTING_KEY || s.setting_key === GEMINI_CONFIG_SETTING_KEY) && !s.deleted_at
    );
    const jsonStr = JSON.stringify(next);

    if (existing) {
      existing.value = jsonStr;
      existing.updated_at = now();
    } else {
      const id = (db.nextId && db.nextId.system_settings) ? db.nextId.system_settings++ : db.system_settings.length + 1;
      db.system_settings.push({
        id,
        key: GEMINI_CONFIG_SETTING_KEY,
        value: jsonStr,
        value_type: 'json',
        category: 'accounting_ai',
        description: 'Cấu hình Google Gemini AI Key cho phân tích kế toán công nợ',
        created_at: now(),
        updated_at: now(),
      });
    }
  });

  return {
    ok: true,
    message: 'Đã lưu cấu hình Google Gemini AI thành công.',
    config: {
      isConfigured: Boolean(next.apiKey),
      isBuiltinKey: next.apiKey === BUILTIN_DEFAULT_GEMINI_KEY,
      maskedKey: maskApiKey(next.apiKey),
      model: next.model,
      temperature: next.temperature,
      updated_at: next.updated_at,
    },
  };
}

/**
 * Gửi HTTP POST request trực tiếp đến Google Gemini REST API (đơn lẻ)
 */
async function requestGeminiRestApiSingle({ apiKey, model, payload, timeoutMs = 35000 }) {
  if (!apiKey) {
    throw new Error('Chưa cấu hình Google Gemini API Key. Vui lòng vào Cài đặt để nhập API Key.');
  }

  const targetModel = model || DEFAULT_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(targetModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  if (typeof fetch === 'function') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'BanhangPos-AccountingAI/1.0',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const parsed = await res.json().catch(() => ({}));
      if (res.status < 200 || res.status >= 300) {
        const errMsg = parsed.error?.message || `Google API trả về lỗi HTTP ${res.status}`;
        const err = new Error(errMsg);
        err.statusCode = res.status;
        err.googleError = parsed.error;
        throw err;
      }

      const candidate = parsed.candidates?.[0];
      const text = candidate?.content?.parts?.[0]?.text;
      if (!text) {
        if (candidate?.finishReason === 'SAFETY') {
          throw new Error('Nội dung bị chặn bởi bộ lọc an toàn của Google Gemini.');
        }
        throw new Error('Không nhận được nội dung phản hồi từ Gemini.');
      }

      return {
        ok: true,
        text: text.trim(),
        finishReason: candidate.finishReason || 'STOP',
        usageMetadata: parsed.usageMetadata || null,
      };
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error(`Yêu cầu tới Google Gemini quá thời gian chờ (${Math.round(timeoutMs / 1000)}s).`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  // Fallback nếu không có fetch toàn cục
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(payload);
    const path = `/v1beta/models/${encodeURIComponent(targetModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const options = {
      hostname: 'generativelanguage.googleapis.com',
      port: 443,
      path: path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'User-Agent': 'BanhangPos-AccountingAI/1.0',
      },
      timeout: timeoutMs,
    };

    const req = https.request(options, (res) => {
      let rawData = '';
      res.setEncoding('utf8');

      res.on('data', (chunk) => { rawData += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(rawData || '{}');
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const errMsg = parsed.error?.message || `Google API trả về lỗi HTTP ${res.statusCode}`;
            const err = new Error(errMsg);
            err.statusCode = res.statusCode;
            err.googleError = parsed.error;
            return reject(err);
          }

          const candidate = parsed.candidates?.[0];
          const text = candidate?.content?.parts?.[0]?.text;
          if (!text) {
            if (candidate?.finishReason === 'SAFETY') {
              return reject(new Error('Nội dung bị chặn bởi bộ lọc an toàn của Google Gemini.'));
            }
            return reject(new Error('Không nhận được nội dung phản hồi từ Gemini.'));
          }

          resolve({
            ok: true,
            text: text.trim(),
            finishReason: candidate.finishReason || 'STOP',
            usageMetadata: parsed.usageMetadata || null,
          });
        } catch (err) {
          reject(new Error(`Lỗi phân tích JSON từ Google Gemini: ${err.message}`));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Yêu cầu tới Google Gemini quá thời gian chờ (35s).'));
    });

    req.on('error', (err) => {
      reject(new Error(`Lỗi kết nối tới máy chủ Google Gemini: ${err.message}`));
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Gửi HTTP POST request với cơ chế Tự động dự phòng thông minh (Auto-Fallback)
 */
async function requestGeminiRestApi({ apiKey, model, payload, timeoutMs = 35000, perAttemptTimeoutMs = null }) {
  const primaryModel = normalizeModel(model || DEFAULT_MODEL);
  const candidateModels = [primaryModel];

  const fallbacks = [
    'gemini-3.8-flash',
    'gemini-2.0-flash',
    'gemini-1.5-flash',
    'gemini-3.5-flash-lite',
    'gemini-flash-lite-latest',
    'gemini-2.5-flash',
    'gemini-1.5-pro',
    'gemini-flash-latest',
  ];
  for (const fb of fallbacks) {
    if (!candidateModels.includes(fb)) {
      candidateModels.push(fb);
    }
  }

  let lastError = null;
  for (let i = 0; i < candidateModels.length; i++) {
    const curModel = candidateModels[i];
    const attemptTimeout = perAttemptTimeoutMs || (timeoutMs ? Math.min(timeoutMs, 20000) : 20000);
    try {
      const res = await requestGeminiRestApiSingle({ apiKey, model: curModel, payload, timeoutMs: attemptTimeout });
      if (curModel !== primaryModel) {
        res.fallbackFrom = primaryModel;
        console.warn(`[GEMINI AI] Model ${primaryModel} gặp sự cố, đã tự động chuyển sang ${curModel} thành công.`);
      }
      res.modelUsed = curModel;
      return res;
    } catch (err) {
      lastError = err;
      const msg = err.message || '';
      const isRecoverable =
        err.statusCode === 404 ||
        err.statusCode === 429 ||
        err.statusCode === 503 ||
        msg.includes('no longer available') ||
        msg.includes('quota') ||
        msg.includes('Quota') ||
        msg.includes('high demand') ||
        msg.includes('503') ||
        msg.includes('429') ||
        msg.includes('ECONNRESET') ||
        msg.includes('fetch failed') ||
        msg.includes('timeout') ||
        msg.includes('quá thời gian chờ') ||
        msg.includes('ETIMEDOUT');

      if (isRecoverable && i < candidateModels.length - 1) {
        console.warn(`[GEMINI AI] Model ${curModel} phản hồi (${msg.slice(0, 100)}). Đang tự động chuyển sang model dự phòng ${candidateModels[i + 1]}...`);
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

/**
 * Kiểm tra kết nối Gemini API Key
 */
async function testGeminiConnection(customApiKey, customModel) {
  const config = getGeminiConfig();
  const apiKey = customApiKey || config.apiKey;
  const rawModel = customModel || config.model;
  const model = normalizeModel(rawModel);

  if (!apiKey) {
    throw new Error('Chưa có API Key để kiểm tra. Vui lòng nhập Google Gemini API Key.');
  }

  const payload = {
    contents: [
      {
        role: 'user',
        parts: [{ text: 'Chào bạn, đây là kiểm tra kết nối API kế toán tự động. Hãy trả lời thật ngắn gọn: "Kết nối thành công!".' }],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 60,
    },
  };

  const response = await requestGeminiRestApi({
    apiKey,
    model,
    payload,
    timeoutMs: 25000,
    perAttemptTimeoutMs: 7000,
  });

  let successMsg = 'Kết nối Google Gemini AI thành công!';
  if (response.fallbackFrom) {
    successMsg += ` (Khóa hợp lệ. Đã tự động kích hoạt model ${response.modelUsed} để tối ưu tốc độ & hạn mức).`;
  }

  return {
    ok: true,
    message: successMsg,
    model: response.modelUsed || model,
    sampleReply: response.text,
  };
}

/**
 * TÍNH NĂNG 1: Phân tích sức khỏe tài chính & Cảnh báo nợ xấu toàn diện
 */
async function analyzeDebtHealth(queryOptions = {}) {
  const config = getGeminiConfig();
  if (!config.isConfigured) {
    throw new Error('Chưa cấu hình Google Gemini API Key. Vui lòng vào Cài đặt để thêm API Key trước khi sử dụng AI.');
  }

  // 1. Lấy dữ liệu kế toán chuẩn xác từ debtAgingService
  const report = debtAgingService.getDebtAgingAnalysis(queryOptions);
  const kpi = report.kpi_summary;

  const topDebtors = (report.customer_summary || []).slice(0, 10).map((c, i) =>
    `${i + 1}. Khách: "${c.customer_name}" (SĐT: ${c.customer_phone || 'Không có'}) | Còn nợ: ${c.total_remaining_debt.toLocaleString('vi-VN')} đ | Tuổi nợ lớn nhất: ${c.max_debt_days} ngày | Đã trả: ${c.payment_progress_percent}% | Rủi ro: ${c.risk_level.toUpperCase()}`
  ).join('\n');

  const systemInstructionText = `Bạn là Trợ lý Kế toán Trưởng chuyên nghiệp và Cố vấn Tài chính Doanh nghiệp (chuẩn mực kế toán Việt Nam).
Nhiệm vụ của bạn là phân tích báo cáo tuổi nợ (Debt Aging) và tình trạng khách chậm thanh toán dựa trên số liệu thực tế được cung cấp.
Phong cách trả lời: Chuyên nghiệp, trực diện, số liệu rõ ràng, đưa ra giải pháp thực tế và hữu ích cho chủ cửa hàng để thu hồi dòng tiền.`;

  const promptText = `Hãy phân tích tình hình công nợ của cửa hàng dựa trên số liệu kế toán sau:

[THỜI GIAN BÁO CÁO]
Từ ngày: ${report.filter_period.from} đến ngày: ${report.filter_period.to} (Kỳ: ${report.filter_period.period_type})

[CÁC CHỈ SỐ KPI TÀI CHÍNH]
- Tổng công nợ phải thu: ${kpi.total_receivable.toLocaleString('vi-VN')} đ
- Tổng nợ quá hạn (chậm thanh toán): ${kpi.total_overdue.toLocaleString('vi-VN')} đ (chiếm ${kpi.overdue_percentage}% tổng nợ)
- Nợ trong hạn (0 - 15 ngày): ${kpi.aging_breakdown.bucket_0_15.amount.toLocaleString('vi-VN')} đ (${kpi.aging_breakdown.bucket_0_15.percentage}%)
- Quá hạn nhẹ (16 - 30 ngày): ${kpi.aging_breakdown.bucket_16_30.amount.toLocaleString('vi-VN')} đ (${kpi.aging_breakdown.bucket_16_30.percentage}%)
- Chậm thanh toán (31 - 60 ngày): ${kpi.aging_breakdown.bucket_31_60.amount.toLocaleString('vi-VN')} đ (${kpi.aging_breakdown.bucket_31_60.percentage}%)
- Nguy cơ nợ xấu (> 60 ngày): ${kpi.aging_breakdown.bucket_over_60.amount.toLocaleString('vi-VN')} đ (${kpi.aging_breakdown.bucket_over_60.percentage}%)
- Số khách hàng còn nợ: ${kpi.debtor_customer_count} khách (trong đó có ${kpi.overdue_customer_count} khách đã quá hạn)

[TOP KHÁCH HÀNG CẦN THU HỒI NỢ]
${topDebtors || 'Không có khách hàng nào còn nợ.'}

Yêu cầu xuất báo cáo phân tích gồm 3 phần rõ ràng:
1. 📊 ĐÁNH GIÁ SỨC KHỎE DÒNG TIỀN: Nhận định tổng quan về tỷ lệ nợ quá hạn và rủi ro thanh khoản của cửa hàng.
2. ⚠️ DANH SÁCH CẢNH BÁO NỢ XẤU & ĐỐI TƯỢNG RỦI RO CAO: Chỉ rõ những khách hàng cần lưu ý đặc biệt và nguyên nhân.
3. 🎯 HÀNH ĐỘNG CẤP BÁCH ĐỀ XUẤT CHO CHỦ CỬA HÀNG: Đưa ra 3-4 bước hành động cụ thể để thu hồi tiền ngay trong tuần này (gọi điện, khóa mua nợ, chiết khấu thanh toán sớm...).`;

  const payload = {
    contents: [{ role: 'user', parts: [{ text: promptText }] }],
    systemInstruction: { parts: [{ text: systemInstructionText }] },
    generationConfig: {
      temperature: config.temperature || 0.2,
      maxOutputTokens: 2500,
    },
  };

  const targetModel = queryOptions.model ? normalizeModel(queryOptions.model) : config.model;

  const response = await requestGeminiRestApi({
    apiKey: config.apiKey,
    model: targetModel,
    payload,
  });

  return {
    ok: true,
    analysis: response.text,
    model_used: response.modelUsed || targetModel,
    generated_at: now(),
    filter_period: report.filter_period,
    kpi_summary: kpi,
  };
}

/**
 * Lấy ảnh chụp nhanh (Snapshot) toàn diện dữ liệu thời gian thực của cửa hàng
 * Bao gồm: Doanh thu hôm nay/tháng này, 15 đơn hàng gần nhất, cảnh báo tồn kho thấp,
 * tra cứu sản phẩm/hóa đơn theo từ khóa, sổ quỹ tiền mặt, khách hàng và công nợ.
 */
function getStoreComprehensiveSnapshot(question = '') {
  try {
    const db = getDb();
    const activeProducts = (db.products || []).filter(p => !p.deleted_at && p.is_active !== false);
    const activeInvoices = (db.invoices || []).filter(i => !i.deleted_at);
    const activeCustomers = (db.customers || []).filter(c => !c.deleted_at);
    const cashBookRecords = (db.cash_book || []).filter(c => !c.deleted_at);
    const activeDetails = (db.invoice_details || []).filter(d => !d.deleted_at);

    // Thời gian hiện tại theo giờ Việt Nam (UTC+7)
    const nowUtc = new Date();
    const vnOffset = 7 * 60 * 60 * 1000;
    const vnNow = new Date(nowUtc.getTime() + vnOffset);
    const todayStr = vnNow.toISOString().slice(0, 10); // YYYY-MM-DD
    const thisMonthStr = todayStr.slice(0, 7); // YYYY-MM

    // 1. Thống kê Doanh thu & Đơn hàng
    let todayOrdersCount = 0;
    let todayRevenue = 0;
    let monthOrdersCount = 0;
    let monthRevenue = 0;
    let totalRevenue = 0;
    let completedInvoices = 0;

    for (const inv of activeInvoices) {
      const invDate = (inv.created_at || '').slice(0, 10);
      const isCompleted = isCompletedInvoiceStatus(inv.status);
      const amt = Number(inv.total || inv.total_amount || 0);

      if (invDate === todayStr) {
        todayOrdersCount++;
        if (isCompleted) todayRevenue += amt;
      }
      if (invDate.startsWith(thisMonthStr)) {
        monthOrdersCount++;
        if (isCompleted) monthRevenue += amt;
      }
      if (isCompleted) {
        totalRevenue += amt;
        completedInvoices++;
      }
    }

    // 2. Quỹ tiền mặt
    let cashIn = 0;
    let cashOut = 0;
    for (const cb of cashBookRecords) {
      const amt = Number(cb.amount || 0);
      if (cb.type === 'in' || cb.transaction_type === 'thu') cashIn += amt;
      if (cb.type === 'out' || cb.transaction_type === 'chi') cashOut += amt;
    }
    const cashBalance = cashIn - cashOut;

    // 3. Tồn kho & Sản phẩm
    // Sắp xếp các mặt hàng có số lượng tồn kho <= 5 hoặc = 0 (cảnh báo hết hàng)
    const lowStockProducts = activeProducts
      .filter(p => Number(p.stock) <= 5)
      .sort((a, b) => Number(a.stock) - Number(b.stock))
      .slice(0, 12)
      .map(p => ({
        ten: p.name,
        sku: p.sku || p.barcode || 'N/A',
        ton_kho: Number(p.stock),
        don_vi: p.unit || 'cái',
        gia_ban: Number(p.retail_price || p.wholesale_price || 0),
      }));

    // 4. Tìm kiếm sản phẩm liên quan nếu câu hỏi có nhắc đến tên sản phẩm hoặc mã SKU
    let searchedProducts = [];
    const qLower = String(question || '').toLowerCase().trim();
    if (qLower.length >= 2) {
      const stopWords = new Set(['bao', 'nhiêu', 'sản', 'phẩm', 'tiền', 'giá', 'cửa', 'hàng', 'quán', 'có', 'không', 'những', 'nào', 'mặt', 'hàng', 'cho', 'tôi', 'xem']);
      const words = qLower.split(/\s+/).filter(w => w.length >= 2 && !stopWords.has(w));
      if (words.length > 0) {
        searchedProducts = activeProducts.filter(p => {
          const pName = (p.name || '').toLowerCase();
          const pSku = (p.sku || '').toLowerCase();
          return words.some(w => pName.includes(w) || pSku.includes(w));
        }).slice(0, 10).map(p => ({
          ten: p.name,
          sku: p.sku,
          gia_ban: Number(p.retail_price || p.wholesale_price || 0),
          gia_nhap: Number(p.import_price || 0),
          ton_kho: Number(p.stock),
          don_vi: p.unit || 'cái',
        }));
      }
    }

    // 5. Danh sách 15 hóa đơn bán hàng gần nhất
    const recentInvoices = [...activeInvoices]
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
      .slice(0, 15)
      .map(inv => {
        let custName = 'Khách lẻ';
        if (inv.customer_id) {
          const c = activeCustomers.find(cu => cu.id === inv.customer_id);
          if (c) custName = c.name || custName;
        }
        return {
          ma_hd: inv.invoice_code,
          ngay_tao: inv.created_at ? new Date(inv.created_at).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '',
          khach: custName,
          tong_tien: Number(inv.total || inv.total_amount || 0),
          da_tra: Number(inv.paid_amount || 0),
          con_no: Number(inv.remaining_amount || 0),
          trang_thai: inv.status === 'completed' ? 'Hoàn thành' : (inv.status === 'pending' ? 'Chờ xử lý' : inv.status),
          thanh_toan: inv.payment_method || 'tiền mặt',
        };
      });

    // 6. Tìm chi tiết hóa đơn cụ thể nếu câu hỏi hỏi đích danh mã đơn
    let specificInvoiceDetail = null;
    const invoiceCodeMatch = qLower.match(/(hd\d+|đơn\s*\d+|hóa đơn\s*\d+)/i);
    if (invoiceCodeMatch) {
      const rawCode = invoiceCodeMatch[0].replace(/(đơn|hóa đơn|\s)/gi, '').toLowerCase();
      const targetInv = activeInvoices.find(i =>
        (i.invoice_code || '').toLowerCase().includes(rawCode) ||
        String(i.id) === rawCode
      );
      if (targetInv) {
        const details = activeDetails.filter(d => Number(d.invoice_id) === Number(targetInv.id));
        specificInvoiceDetail = {
          ma_hd: targetInv.invoice_code,
          ngay_tao: targetInv.created_at,
          tong_tien: Number(targetInv.total || targetInv.total_amount || 0),
          da_tra: Number(targetInv.paid_amount || 0),
          con_no: Number(targetInv.remaining_amount || 0),
          mon_hang: details.map(d => ({
            ten_mon: d.product_name || d.name,
            so_luong: d.quantity,
            don_gia: d.unit_price || d.price,
            thanh_tien: d.line_total || (d.quantity * (d.unit_price || d.price || 0)),
          })),
        };
      }
    }

    // 7. Tra cứu thông tin khách hàng và công nợ nếu câu hỏi có chứa Số Điện Thoại (SĐT)
    let queriedCustomerDebt = null;
    const phoneMatch = qLower.match(/(?:0|\+84)[35789]\d{8}|\b0\d{9}\b/);
    const extractedPhone = phoneMatch ? phoneMatch[0].replace('+84', '0') : null;

    if (extractedPhone) {
      const cust = activeCustomers.find(c => c.phone && c.phone.replace(/[\s.-]/g, '').includes(extractedPhone));
      if (cust) {
        try {
          const debtData = debtAgingService.getSingleCustomerDebtReport(Number(cust.id));
          queriedCustomerDebt = {
            tim_thay: true,
            id: cust.id,
            ten_khach: cust.name,
            sdt: cust.phone,
            dia_chi: cust.address || '',
            tong_tien_no: debtData?.customer?.total_remaining_debt || 0,
            tuoi_no_ngay: debtData?.customer?.max_debt_days || 0,
            muc_do_rui_ro: debtData?.customer?.risk_level || 'low',
            danh_sach_hoa_don_no: (debtData?.invoices || []).map(inv => ({
              ma_hd: inv.invoice_code,
              ngay: inv.invoice_date,
              tong_tien: inv.total_amount,
              con_no: inv.remaining_amount,
              ngay_qua_han: inv.debt_age_days,
            })),
          };
        } catch (_) {}
      } else {
        queriedCustomerDebt = {
          tim_thay: false,
          sdt: extractedPhone,
          ghi_chu: 'Số điện thoại này chưa có trong danh bạ khách hàng của quán.',
        };
      }
    }

    // 8. Thông tin cửa hàng
    const storeRow = (db.system_settings || []).find(s => s && (s.key === 'store_info' || s.setting_key === 'store_info') && !s.deleted_at);
    let storeInfo = null;
    if (storeRow && storeRow.value) {
      try {
        storeInfo = typeof storeRow.value === 'string' ? JSON.parse(storeRow.value) : storeRow.value;
      } catch (_) {}
    }

    return {
      today: todayStr,
      store_name: storeInfo?.store_name || storeInfo?.name || 'Cửa hàng Bán Hàng Pos',
      store_phone: storeInfo?.phone || '',
      store_address: storeInfo?.address || '',
      total_products: activeProducts.length,
      low_stock_count: activeProducts.filter(p => Number(p.stock) <= 5).length,
      low_stock_products: lowStockProducts,
      searched_products: searchedProducts,
      total_invoices: activeInvoices.length,
      completed_invoices: completedInvoices,
      total_revenue: totalRevenue,
      today_orders_count: todayOrdersCount,
      today_revenue: todayRevenue,
      month_orders_count: monthOrdersCount,
      month_revenue: monthRevenue,
      total_customers: activeCustomers.length,
      cash_in: cashIn,
      cash_out: cashOut,
      cash_balance: cashBalance,
      recent_invoices: recentInvoices,
      specific_invoice: specificInvoiceDetail,
      queried_customer_debt: queriedCustomerDebt,
      extracted_phone: extractedPhone,
    };
  } catch (err) {
    console.error('[GEMINI SNAPSHOT ERROR]', err);
    return {
      today: new Date().toISOString().slice(0, 10),
      store_name: 'Cửa hàng Bán Hàng Pos',
      store_phone: '',
      store_address: '',
      total_products: 0,
      low_stock_count: 0,
      low_stock_products: [],
      searched_products: [],
      total_invoices: 0,
      completed_invoices: 0,
      total_revenue: 0,
      today_orders_count: 0,
      today_revenue: 0,
      month_orders_count: 0,
      month_revenue: 0,
      total_customers: 0,
      cash_in: 0,
      cash_out: 0,
      cash_balance: 0,
      recent_invoices: [],
      specific_invoice: null,
    };
  }
}

/**
 * TÍNH NĂNG 2: Hỏi đáp tự nhiên với Trợ lý AI Thông Minh Đa Năng (Google Gemini AI)
 * Hoạt động như một Chatbot AI đỉnh cao (như ChatGPT / Gemini), giải đáp mọi câu hỏi,
 * tra cứu số liệu thời gian thực của cửa hàng, tư vấn kinh doanh và đời sống.
 */
async function askDebtAssistant({ question, queryOptions = {}, history = [], model, image }) {
  const effectiveQuestion = (question && typeof question === 'string') ? question.trim() : '';
  const hasText = effectiveQuestion.length > 0;
  if (!hasText && !image) {
    throw new Error('Vui lòng nhập câu hỏi hoặc dán hình ảnh cho Trợ lý AI.');
  }

  const isAuthorQuestion = hasText && /(ai code|ai lập trình|ai lap trinh|ai tạo ra|ai tao ra|ai viết|ai viet|tác giả|tac gia|developer|lập trình viên|lap trinh vien)/i.test(effectiveQuestion);

  if (isAuthorQuestion) {
    return {
      ok: true,
      reply: 'Phần mềm Bán Hàng Pos được nghiên cứu, phát triển và lập trình hoàn toàn bởi **Lập trình viên Văn Kha**.\n\nHệ thống tích hợp toàn diện từ bán hàng, quản lý kho, công nợ, báo cáo tài chính đến Trợ lý ảo AI thông minh (Google Gemini AI). Rất hân hạnh được đồng hành và hỗ trợ anh/chị!',
      model_used: 'Kha AI Assistant',
    };
  }

  const config = getGeminiConfig();
  if (!config.isConfigured) {
    throw new Error('Chưa cấu hình Google Gemini API Key. Chủ cửa hàng vui lòng bấm vào biểu tượng ⚙️ Cài đặt ở góc trên khung chat để nhập API Key (miễn phí từ Google) và bắt đầu trò chuyện như ChatGPT/Gemini!');
  }

  // Lấy dữ liệu công nợ mới nhất
  const report = debtAgingService.getDebtAgingAnalysis({ ...queryOptions, limit: 150 });
  const kpi = report.kpi_summary;

  const topDebtors = (report.customer_summary || []).slice(0, 15).map(c => ({
    ten_khach: c.customer_name,
    sdt: c.customer_phone || 'n/a',
    tong_no: c.total_remaining_debt,
    tuoi_no_ngay: c.max_debt_days,
    so_don_no: c.unpaid_invoices_count,
    rui_ro: c.risk_level,
  }));

  // Lọc danh sách hóa đơn chi tiết phục vụ trích xuất (đơn hàng, công nợ, đã trả, còn nợ)
  const allInvoices = report.invoice_details || [];
  const qLower = effectiveQuestion.toLowerCase();

  let selectedInvoices = [];
  // Ưu tiên khớp theo mã hóa đơn hoặc tên khách hàng nếu có trong câu hỏi
  if (qLower.includes('hd') || qLower.includes('đơn') || qLower.includes('hóa đơn')) {
    const matched = allInvoices.filter(inv =>
      qLower.includes(String(inv.invoice_code || '').toLowerCase()) ||
      (inv.customer_name && qLower.includes(inv.customer_name.toLowerCase()))
    );
    if (matched.length > 0) {
      selectedInvoices = matched.slice(0, 30);
    }
  }

  if (selectedInvoices.length === 0) {
    // Mặc định: lấy các hóa đơn còn nợ / đang theo dõi
    const unpaidInvoices = allInvoices.filter(inv => inv.remaining_amount > 0);
    selectedInvoices = (unpaidInvoices.length > 0 ? unpaidInvoices : allInvoices).slice(0, 35);
  }

  const invoiceListCompact = selectedInvoices.map((inv, idx) => ({
    stt: idx + 1,
    ma_hd: inv.invoice_code,
    khach_hang: inv.customer_name || 'Khách lẻ',
    sdt: inv.customer_phone || '',
    ngay_ban: inv.invoice_date,
    han_tra: inv.due_date || 'Không có',
    tong_tien: inv.total_amount,
    da_tra: inv.paid_amount,
    con_no: inv.remaining_amount,
    tien_do_tra: `${inv.payment_progress_percent}%`,
    so_ngay_no: inv.debt_age_days,
    trang_thai: inv.remaining_amount <= 0
      ? 'Đã trả đủ'
      : (inv.debt_age_days > 60
        ? 'Rủi ro nợ xấu'
        : (inv.is_overdue
          ? 'Quá hạn'
          : (inv.paid_amount > 0 ? 'Đang trả dở' : 'Chưa trả'))),
  }));

  const storeSnapshot = getStoreComprehensiveSnapshot(effectiveQuestion);

  const systemInstructionText = `Bạn là Trợ Lý AI Thông Minh (Google Gemini AI), hoạt động như một con Chatbot AI toàn năng đỉnh cao (tương đương như ChatGPT và Google Gemini) hỗ trợ chủ cửa hàng Bán Hàng Pos.

[PHONG CÁCH GIAO TIẾP & NGUYÊN TẮC HOẠT ĐỘNG NHƯ CHATGPT / GEMINI]
1. TRẢ LỜI MỌI CÂU HỎI THÔNG MINH, TỰ NHIÊN, LINH HOẠT VÀ ĐA NĂNG:
   - Bạn trò chuyện tự nhiên, lưu loát, thông minh, nhạy bén, súc tích và cực kỳ lịch sự, thân thiện như ChatGPT và Gemini chính hãng.
   - Sẵn sàng giải đáp BẤT KỲ CÂU HỎI NÀO của chủ cửa hàng: kinh doanh, mẹo bán hàng, chiến lược thu hút khách, quản lý nhân viên, chống thất thoát hàng, đời sống, khoa học công nghệ, kỹ thuật, giải thích thuật ngữ, tính toán, dịch thuật, viết bài đăng mạng xã hội (Facebook, Zalo, TikTok), soạn kịch bản tư vấn, thơ ca, trò chuyện phiếm...
   - Tuyệt đối KHÔNG tự xưng máy móc, KHÔNG dùng câu cửa miệng rườm rà hay rập khuôn (ví dụ: cấm dùng "Với tư cách là Trợ lý Kế toán Trưởng ảo...", "Là một mô hình AI...", "Tôi chỉ là trợ lý..."). Hãy đi thẳng vào câu trả lời một cách tự nhiên, mạch lạc, súc tích và hữu ích.
   - Khi chủ shop hỏi về các tính năng công nghệ hoặc giải pháp tích hợp (ví dụ: tự động gửi tin nhắn Zalo, kết nối Zalo OA / ZNS, thông báo SMS, bot bán hàng, API...): Hãy giải thích rõ ràng cơ chế hoạt động, tư vấn giải pháp kỹ thuật, ưu nhược điểm và các bước triển khai thực tế một cách chuyên nghiệp như một chuyên gia AI và công nghệ phần mềm, không thoái thác hay máy móc.
   - Về nghiệp vụ thuế GTGT: Giải thích cặn kẽ, rõ ràng. Thuế GTGT đầu ra trích từ các hóa đơn bán hàng hoàn thành, thuế GTGT đầu vào trích từ phiếu nhập hàng, thuế GTGT phải nộp = Thuế đầu ra - Thuế đầu vào được khấu trừ.

[BẢN ĐỒ CẤU TRÚC MENU & HƯỚNG DẪN THAO TÁC CHI TIẾT TỪNG CHỨC NĂNG CỦA PHẦN MỀM]
Bạn là Trợ lý hiểu rõ 100% cấu trúc menu của phần mềm Bán Hàng Pos (menu bên trái màn hình). Khi chủ shop hỏi "chức năng này ở đâu", "menu nào", "làm thế nào để...", bạn PHẢI chỉ đường dẫn chính xác theo quy tắc: [Menu Cha] -> [Menu Con] (#/đường_dẫn) và các bước thao tác 1, 2, 3 rõ ràng:

1. 🏠 TRANG CHỦ (#/):
   - Màn hình tổng quan (Dashboard), xem nhanh doanh thu hôm nay, số đơn hàng, các lối tắt bán hàng và kiểm tra nhanh tình hình kinh doanh.

2. 📋 NHÓM ĐƠN HÀNG (Menu cha: "Đơn hàng"):
   - Tạo đơn hàng (#/tao-don-hang): Màn hình bán hàng POS. Thao tác: Quét mã vạch / gõ tên chọn món -> Chọn số lượng -> Chọn khách hàng (hoặc Khách lẻ) -> Nhập giảm giá/chiết khấu -> Chọn thanh toán (Tiền mặt / Chuyển khoản) -> Bấm "Thanh toán & In hóa đơn".
   - Danh sách đơn hàng (#/danh-sach-don-hang): Quản lý toàn bộ hóa đơn đã bán. Thao tác: Lọc theo khoảng ngày, mã đơn, khách, trạng thái (Hoàn thành, Chờ xử lý, Hủy) -> Bấm "Xem" để xem chi tiết món -> Bấm "In" in lại hóa đơn -> Bấm "Xuất Excel" tải file danh sách đơn hàng.

3. 📦 NHÓM DANH MỤC (Menu cha: "Danh mục"):
   - Sản phẩm (#/san-pham): Quản lý danh mục hàng hóa. Thao tác: Bấm "+ Thêm sản phẩm" -> Nhập tên, mã SKU/Barcode, giá vốn, giá bán, đơn vị tính -> Bấm Lưu. Hỗ trợ nhập hàng loạt từ Excel.
   - Kho hàng (#/kho-hang): Quản lý tồn kho thực tế. Thao tác: Xem tồn kho từng mặt hàng, cảnh báo hết hàng / sắp hết / âm kho, kiểm kê điều chỉnh kho thực tế, bấm "Gửi báo cáo kho" về Telegram.
   - Khách hàng (#/khach-hang): Quản lý danh bạ khách hàng. Thao tác: Bấm "+ Thêm khách hàng" -> Nhập tên, SĐT, địa chỉ, xem lịch sử mua hàng và tổng công nợ của từng khách.
   - Nhập hàng (#/nhap-hang): Nhập hàng từ nhà cung cấp vào kho. Thao tác: Bấm "Tạo phiếu nhập" -> Chọn nhà cung cấp -> Thêm mặt hàng cần nhập -> Nhập số lượng và giá nhập -> Nhập số tiền đã trả NCC -> Bấm Hoàn thành để tự động tăng tồn kho.
   - Đối Tác (#/nha-cung-cap): Quản lý danh sách nhà cung cấp (NCC). Thao tác: Thêm NCC, lưu SĐT, địa chỉ, theo dõi công nợ phải trả cho nhà cung cấp.

4. ⚖️ NHÓM KẾ TOÁN & AI (Menu cha: "Kế toán & AI"):
   - Tuổi nợ & Trợ lý AI (#/ke-toan/cong-no): Quản lý và thu hồi công nợ chuẩn doanh nghiệp. Thao tác: Phân tích 4 nhóm tuổi nợ (0-15 ngày trong hạn, 16-30 ngày quá hạn nhẹ, 31-60 ngày cần nhắc, >60 ngày nợ xấu) -> Bấm "Nhắc nợ" để AI tự soạn tin nhắn đòi nợ theo phong cách -> Bấm "Xuất Excel Công Nợ" tải file 2 sheet -> Bấm "Gửi Telegram" gửi báo cáo công nợ cho chủ quán.
   - Tổng quan kế toán (#/ke-toan): Báo cáo tài chính tổng hợp. Thao tác: Chọn kỳ ngày/tháng/quý -> Xem Doanh thu thuần, Giá vốn hàng bán, Lợi nhuận gộp, Số lượng hóa đơn.
   - Báo cáo thuế GTGT (#/ke-toan/bao-cao-thue): Theo dõi thuế GTGT. Thao tác: Chọn tháng/quý -> Bấm "Xem báo cáo" -> Tổng hợp Thuế GTGT đầu ra (từ hóa đơn bán), Thuế GTGT đầu vào (từ phiếu nhập), Số thuế phải nộp (Đầu ra - Đầu vào) -> Bấm "Lưu snapshot" hoặc "Xuất Excel".
   - Báo cáo tồn kho (#/ke-toan/bao-cao-ton-kho): Báo cáo giá trị tồn kho kế toán, cảnh báo hàng đọng vốn lâu ngày.
   - Nhật ký hoạt động (#/ke-toan/nhat-ky): Audit log an toàn dữ liệu. Thao tác: Xem lịch sử thao tác thêm/sửa/xóa/đăng nhập của nhân viên và admin, đối chiếu thay đổi trước và sau.

5. 🎛️ NHÓM QUẢN LÝ (Menu cha: "Quản lý"):
   - Thống kê (#/thong-ke): Biểu đồ phân tích doanh thu, lợi nhuận và xu hướng bán hàng theo ngày/tuần/tháng/năm.
   - Sổ quỹ (#/so-quy): Quản lý dòng tiền mặt (Thu / Chi). Thao tác: Bấm "+ Tạo phiếu thu" hoặc "+ Tạo phiếu chi" -> Nhập số tiền, lý do, người nộp/nhận -> Bấm Lưu -> Hệ thống tự tính số dư quỹ hiện tại để chống thất thoát.
   - Báo cáo theo đơn hàng (#/bao-cao-don-hang hoặc #/bao-cao-theo-don-hang): Xem thống kê doanh thu chi tiết theo từng đơn hàng, lọc theo khách hàng.
   - Báo cáo sản phẩm (#/bao-cao-san-pham hoặc #/bao-cao-theo-san-pham): Xếp hạng mặt hàng bán chạy nhất (Best seller), phân tích số lượng bán và doanh thu từng sản phẩm.
   - Top khách hàng (#/top-khach-hang): Bảng xếp hạng khách hàng VIP mua nhiều nhất, đem lại doanh thu cao nhất.
   - Cài đặt (#/cai-dat): Cấu hình toàn bộ phần mềm:
     * Cài đặt Cửa hàng: Đổi tên shop, SĐT hotline, địa chỉ, logo.
     * Mẫu in hóa đơn: Tùy chỉnh khổ giấy in (K80, K58, A4, A5), căn chỉnh nội dung bill.
     * Tài khoản & Phân quyền: Tạo tài khoản thu ngân, nhân viên kho, phân quyền xem/sửa/xóa.
     * Gemini AI Kế toán: Nhập Google Gemini API Key, chọn model (Gemini 3.8 Flash, 2.0 Flash...), chỉnh nhiệt độ phản hồi.
     * Sao lưu & Khôi phục: Tự động sao lưu dữ liệu, khôi phục dữ liệu khi cần.
     * Kết nối Telegram: Cài đặt Bot token và Chat ID để nhận thông báo đơn hàng và báo cáo tự động.

2. TRA CỨU DỮ LIỆU CỬA HÀNG THỜI GIAN THỰC (KHI ĐƯỢC HỎI VỀ QUÁN):
   - Khi chủ cửa hàng hỏi về số liệu thực tế của quán (doanh thu hôm nay/tháng này, số đơn hàng, hàng sắp hết/tồn kho thấp, danh sách khách nợ, chi tiết hóa đơn, sổ quỹ tiền mặt...):
     Hãy sử dụng chính xác các con số trong phần [DỮ LIỆU THỜI GIAN THỰC CỦA CỬA HÀNG] bên dưới để phản hồi.
   - Trình bày dạng BẢNG MARKDOWN chuẩn đẹp khi liệt kê danh sách (hóa đơn, mặt hàng, công nợ...), các con số tiền luôn có dấu chấm phân cách (vd: 150.000 đ) và tóm tắt tổng kết rõ ràng.
   - Khi câu hỏi là về các chủ đề tự do khác (kiến thức chung, trò chuyện, lời khuyên, viết bài quảng cáo, dịch thuật...): Hãy tự do sáng tạo và đưa ra câu trả lời xuất sắc nhất như ChatGPT/Gemini!

[DỮ LIỆU THỜI GIAN THỰC CỦA CỬA HÀNG - CẬP NHẬT TỨC THÌ]
- Ngày hệ thống hôm nay: ${storeSnapshot.today}
- Tên cửa hàng: ${storeSnapshot.store_name} ${storeSnapshot.store_phone ? `(Hotline: ${storeSnapshot.store_phone})` : ''}
- BÁN HÀNG & DOANH THU:
  * Hôm nay (${storeSnapshot.today}): Đã tạo ${storeSnapshot.today_orders_count} đơn hàng, Doanh thu: ${storeSnapshot.today_revenue.toLocaleString('vi-VN')} đ
  * Tháng này: Đã tạo ${storeSnapshot.month_orders_count} đơn hàng, Doanh thu: ${storeSnapshot.month_revenue.toLocaleString('vi-VN')} đ
  * Toàn thời gian: Tổng ${storeSnapshot.total_invoices} hóa đơn (Đã hoàn tất: ${storeSnapshot.completed_invoices} đơn, Tổng doanh thu tích lũy: ${storeSnapshot.total_revenue.toLocaleString('vi-VN')} đ)
- KHO HÀNG & SẢN PHẨM:
  * Tổng số mặt hàng quản lý: ${storeSnapshot.total_products.toLocaleString('vi-VN')} sản phẩm
  * Mặt hàng cảnh báo tồn kho thấp (<= 5 cái hoặc hết hàng):
${JSON.stringify(storeSnapshot.low_stock_products, null, 2)}
${storeSnapshot.searched_products.length > 0 ? `- Mặt hàng khớp với từ khóa hỏi: \n${JSON.stringify(storeSnapshot.searched_products, null, 2)}` : ''}
- ĐƠN HÀNG GẦN ĐÂY NHẤT (15 đơn mới nhất):
${JSON.stringify(storeSnapshot.recent_invoices, null, 2)}
${storeSnapshot.specific_invoice ? `- CHI TIẾT ĐƠN HÀNG ĐƯỢC HỎI ĐÍCH DANH:\n${JSON.stringify(storeSnapshot.specific_invoice, null, 2)}` : ''}
- KHÁCH HÀNG & CÔNG NỢ:
  * Tổng số khách hàng: ${storeSnapshot.total_customers.toLocaleString('vi-VN')} khách
  * Tổng công nợ phải thu: ${kpi.total_receivable.toLocaleString('vi-VN')} đ (Nợ quá hạn: ${kpi.total_overdue.toLocaleString('vi-VN')} đ, Nguy cơ nợ xấu: ${kpi.bad_debt_risk_amount.toLocaleString('vi-VN')} đ)
  * Top khách hàng nợ nhiều nhất:
${JSON.stringify(topDebtors, null, 2)}
  * Chi tiết danh sách hóa đơn theo dõi công nợ (${invoiceListCompact.length} đơn):
${JSON.stringify(invoiceListCompact, null, 2)}
- QUỸ TIỀN MẶT (SỔ QUỸ):
  * Tổng thu: ${storeSnapshot.cash_in.toLocaleString('vi-VN')} đ | Tổng chi: ${storeSnapshot.cash_out.toLocaleString('vi-VN')} đ | Số dư quỹ hiện tại: ${storeSnapshot.cash_balance.toLocaleString('vi-VN')} đ
${storeSnapshot.queried_customer_debt ? `- THÔNG TIN KHÁCH HÀNG TÌM ĐƯỢC THEO SĐT:\n` + JSON.stringify(storeSnapshot.queried_customer_debt, null, 2) : ''}

3. KHI CHỦ SHOP GỬI SĐT HOẶC YÊU CẦU SOẠN TIN NHẮN ĐÒI TIỀN / NHẮC NỢ QUA ZALO:
   - Nếu trong câu hỏi có SĐT hoặc tìm thấy khách hàng trong danh bạ:
     * Sử dụng chính xác Tên khách và Số tiền nợ thực tế (nếu tìm thấy khách) hoặc số tiền được cung cấp.
   - SOẠN TIN NHẮN NHẮC NỢ CỰC KỲ KHÉO LÉO & VĂN MINH:
     * Tông giọng: Nhẹ nhàng, khéo léo, tình cảm, tôn trọng, giữ gìn quan hệ kinh doanh lâu dài, không làm khách phật ý nhưng thông tin số tiền và thời hạn thanh toán phải rõ ràng, minh bạch.
     * Trình bày mẫu tin nhắn hoàn chỉnh trong khối trích dẫn hoặc khung rõ ràng, có icon lịch sự (🛒, 💳, 🙏), lời hỏi thăm ân cần, số tiền cần thanh toán và lời cảm ơn.
   - CUNG CẤP ĐƯỜNG LINK TIỆN ÍCH 1-CLICK MỞ ZALO:
     * Luôn tạo đường link Markdown để chủ shop chỉ cần bấm 1 click là mở Zalo với số điện thoại đó:
       [👉 Bấm vào đây để mở Zalo nhắn ngay cho SĐT ${storeSnapshot.extracted_phone || 'khách'}](https://zalo.me/${storeSnapshot.extracted_phone || ''})
   - TƯ VẤN TÍCH HỢP TỰ ĐỘNG GỬI QUA API (NẾU HỎI VỀ BOT TỰ ĐỘNG NHẮN):
     * Giải thích rõ: Hiện tại chủ shop có thể dùng cách 1-Click Zalo miễn phí và tiện lợi ngay trên màn hình. Để bot tự động 100% gửi tin ngầm không cần người bấm, có thể tích hợp Zalo OA & Zalo ZNS API (Zalo Notification Service) chính thức của Zalo.

4. KHI CHỦ SHOP GỬI HOẶC DÁN HÌNH ẢNH (ẢNH CHỤP MÀN HÌNH, HÓA ĐƠN, BIÊN LAI, CHỨNG TỪ, MẶT HÀNG):
   - Bạn có năng lực thị giác máy tính đỉnh cao (Google Gemini Multimodal Vision).
   - Hãy quan sát và đọc kỹ toàn bộ nội dung trong ảnh: chữ viết, số tiền, ngày giờ, số tài khoản ngân hàng, mã đơn hàng, tên sản phẩm, bảng biểu số liệu hoặc thông báo trên màn hình.
   - Nếu là ảnh HÓA ĐƠN BÁN / BIÊN LAI CHUYỂN KHOẢN: Đọc tên người gửi, người nhận, số tiền chuyển khoản, mã giao dịch, và đối chiếu với đơn hàng của shop.
   - Nếu là ảnh GIAO DIỆN PHẦN MỀM / LỖI MÀN HÌNH: Nhận diện chính xác đang ở menu nào và hướng dẫn cụ thể cách thao tác hoặc xử lý.`;

  // Xây dựng lịch sử trò chuyện và làm sạch các cụm từ dập khuôn cũ nếu có trong lịch sử
  const contents = [];
  if (Array.isArray(history)) {
    history.slice(-8).forEach(item => {
      if (item && item.role && item.text) {
        let cleanText = String(item.text).trim();
        cleanText = cleanText
          .replace(/Với tư cách là Trợ lý Kế toán Trưởng ảo của phần mềm Bán Hàng Pos[^,]*,?\s*/gi, '')
          .replace(/\(được nghiên cứu, phát triển và lập trình hoàn toàn bởi Lập trình viên Văn Kha\),?\s*/gi, '')
          .replace(/Nếu Lập trình viên Văn Kha tiến hành kết nối \[tích hợp\]/gi, 'Nếu chúng ta tiến hành tích hợp')
          .trim();

        if (cleanText) {
          contents.push({
            role: item.role === 'user' ? 'user' : 'model',
            parts: [{ text: cleanText }],
          });
        }
      }
    });
  }

  let cleanImage = null;
  if (image) {
    if (typeof image === 'string') {
      const match = image.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        cleanImage = {
          mimeType: match[1],
          data: match[2],
        };
      } else {
        cleanImage = {
          mimeType: 'image/jpeg',
          data: image,
        };
      }
    } else if (typeof image === 'object' && image.data) {
      let mimeType = image.mimeType || 'image/jpeg';
      let data = image.data;
      if (typeof data === 'string' && data.startsWith('data:')) {
        const match = data.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          mimeType = match[1];
          data = match[2];
        }
      }
      cleanImage = { mimeType, data };
    }
  }

  const userParts = [];
  if (cleanImage && cleanImage.data) {
    userParts.push({
      inlineData: {
        mimeType: cleanImage.mimeType || 'image/jpeg',
        data: cleanImage.data,
      },
    });
  }

  const promptText = (hasText ? question.trim() : '') || (cleanImage ? 'Hãy quan sát thật kỹ bức ảnh này (đọc các con số, dòng chữ, hóa đơn, biên lai chuyển khoản hoặc bảng số liệu nếu có) và phân tích, giải thích chi tiết cho tôi.' : '');
  userParts.push({ text: promptText });

  contents.push({
    role: 'user',
    parts: userParts,
  });

  const payload = {
    contents,
    systemInstruction: { parts: [{ text: systemInstructionText }] },
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 2500,
    },
  };

  const targetModel = model ? normalizeModel(model) : config.model;

  const response = await requestGeminiRestApi({
    apiKey: config.apiKey,
    model: targetModel,
    payload,
  });

  return {
    ok: true,
    reply: response.text,
    model_used: response.modelUsed || targetModel,
  };
}

/**
 * TÍNH NĂNG 3: Tự động soạn tin nhắn nhắc nợ thông minh & khéo léo cho khách hàng
 */
async function generateDebtReminderMessage({ customerId, invoiceId, style = 'professional', customNotes = '' }) {
  const config = getGeminiConfig();
  if (!config.isConfigured) {
    throw new Error('Chưa cấu hình Google Gemini API Key. Vui lòng vào Cài đặt để thêm API Key.');
  }

  if (!customerId) {
    throw new Error('Thiếu ID khách hàng cần soạn tin nhắn nhắc nợ.');
  }

  const singleReport = debtAgingService.getSingleCustomerDebtReport(Number(customerId));
  const customer = singleReport.customer;

  if (!customer) {
    throw new Error(`Không tìm thấy dữ liệu công nợ cho khách hàng ID #${customerId}.`);
  }

  // Tìm hóa đơn cụ thể nếu có
  let specificInvoice = null;
  if (invoiceId) {
    specificInvoice = (singleReport.invoices || []).find(inv => Number(inv.invoice_id) === Number(invoiceId));
  }

  const styleGuides = {
    gentle: 'Thân thiện, khéo léo, tình cảm, tôn trọng, nhắc nhở nhẹ nhàng như nhắc một người bạn/đối tác quen lâu năm.',
    professional: 'Lịch sự, chuyên nghiệp, chuẩn mực kinh doanh, đầy đủ thông tin hóa đơn và hạn thanh toán, không gay gắt.',
    urgent: 'Nghiêm túc, dứt khoát, nhấn mạnh thời hạn đã quá hạn nhiều ngày, đề nghị ưu tiên thanh toán ngay trong ngày.',
  };

  const promptText = `Hãy giúp chủ cửa hàng soạn 1 tin nhắn ngắn gọn, khéo léo và hiệu quả để gửi cho khách hàng qua Zalo hoặc SMS để nhắc thanh toán công nợ:

[THÔNG TIN KHÁCH HÀNG]
- Tên khách hàng: "${customer.customer_name}"
- Số điện thoại: ${customer.customer_phone || 'Chưa cập nhật'}
- Tổng số tiền còn nợ cửa hàng: ${customer.total_remaining_debt.toLocaleString('vi-VN')} đ
- Số ngày nợ lớn nhất: ${customer.max_debt_days} ngày
- Mức độ rủi ro: ${customer.risk_level.toUpperCase()}
${specificInvoice ? `- Nhắc riêng cho hóa đơn: Mã "${specificInvoice.invoice_code}", Ngày bán: ${specificInvoice.invoice_date}, Còn nợ: ${specificInvoice.remaining_amount.toLocaleString('vi-VN')} đ, Quá hạn: ${specificInvoice.debt_age_days} ngày` : ''}
${customNotes ? `- Ghi chú thêm từ chủ shop: "${customNotes}"` : ''}

[YÊU CẦU PHONG CÁCH]
- Tông giọng: ${styleGuides[style] || styleGuides.professional}
- Độ dài: Khoảng 3 - 6 dòng (ngắn gọn, xúc tích, không làm khách khó chịu).
- Đầy đủ thông tin: Tên khách, số tiền nợ rõ ràng (${customer.total_remaining_debt.toLocaleString('vi-VN')} đ), lời cảm ơn.

Yêu cầu xuất ra:
Chỉ viết nội dung tin nhắn hoàn chỉnh, có định dạng xuống dòng, icon phù hợp (như 🛒, 💳, 🙏), xưng hô lịch sự với khách hàng để chủ shop có thể bấm 1-click Copy và gửi ngay lập tức. Không viết thêm lời dẫn vòng vo.`;

  const payload = {
    contents: [{ role: 'user', parts: [{ text: promptText }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 1000,
    },
  };

  const response = await requestGeminiRestApi({
    apiKey: config.apiKey,
    model: config.model,
    payload,
  });

  return {
    ok: true,
    customer_id: customer.customer_id,
    customer_name: customer.customer_name,
    customer_phone: customer.customer_phone,
    total_debt: customer.total_remaining_debt,
    style: style,
    message: response.text,
  };
}

/**
 * Chuyển đổi và định dạng toàn bộ lỗi kỹ thuật từ Google Gemini sang tiếng Việt thân thiện, rõ ràng
 */
function formatGeminiErrorMessage(error) {
  if (!error) return 'Đã xảy ra lỗi không xác định khi kết nối với Trợ lý Google Gemini.';
  const msg = typeof error === 'string' ? error : (error.message || String(error));

  if (msg.includes('no longer available') || msg.includes('404')) {
    return 'Mô hình AI này đã được Google nâng cấp phiên bản mới. Hệ thống đã tự động chuyển đổi sang mô hình Gemini tối ưu.';
  }
  if (msg.includes('exceeded your current quota') || msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('Quota exceeded')) {
    return 'Hạn mức yêu cầu của Google Gemini AI bị gián đoạn (Quota Limit). Nếu bạn dùng gói Pro trên Google AI Studio, vui lòng kiểm tra liên kết thanh toán Google Cloud hoặc hệ thống sẽ tự động dùng Gemini Flash để phản hồi tức thì.';
  }
  if (msg.includes('experiencing high demand') || msg.includes('503') || msg.includes('UNAVAILABLE')) {
    return 'Máy chủ Google Gemini AI hiện đang quá tải tạm thời do lượng truy cập cao. Vui lòng bấm thử lại sau giây lát.';
  }
  if (msg.includes('API key not valid') || msg.includes('API_KEY_INVALID') || msg.includes('invalid api key')) {
    return 'Khóa API Key Google Gemini không hợp lệ hoặc đã bị vô hiệu hóa. Chủ cửa hàng vui lòng bấm vào biểu tượng ⚙️ Cài đặt ở góc trên khung chat để kiểm tra hoặc nhập API Key mới.';
  }
  if (msg.includes('SAFETY') || msg.includes('blocked')) {
    return 'Nội dung câu hỏi bị bộ lọc an toàn của Google Gemini từ chối xử lý.';
  }
  if (msg.includes('location is not supported') || msg.includes('unsupported location')) {
    return 'Vùng địa lý hoặc mạng hiện tại chưa được hỗ trợ trực tiếp bởi máy chủ Google Gemini API.';
  }
  if (msg.includes('quá thời gian chờ') || msg.includes('timeout') || msg.includes('ETIMEDOUT') || msg.includes('ESOCKETTIMEDOUT')) {
    return 'Kết nối tới máy chủ Google Gemini bị quá thời gian chờ (Timeout). Vui lòng kiểm tra kết nối mạng Internet.';
  }
  if (msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND')) {
    return 'Không thể kết nối đến máy chủ Google Gemini. Vui lòng kiểm tra lại kết nối mạng Internet.';
  }
  return msg;
}

module.exports = {
  getGeminiConfig,
  saveGeminiConfig,
  maskApiKey,
  testGeminiConnection,
  analyzeDebtHealth,
  askDebtAssistant,
  generateDebtReminderMessage,
  formatGeminiErrorMessage,
  getStoreComprehensiveSnapshot,
  SUPPORTED_MODELS,
  DEFAULT_MODEL,
};
