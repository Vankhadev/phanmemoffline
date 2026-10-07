/**
 * Service Báo Cáo & Cảnh Báo Công Nợ Tự Động Qua Telegram Bot
 * Giai đoạn 5: Tự động hóa báo cáo định kỳ, gửi tin nhắn cảnh báo nợ xấu và tương tác qua lệnh /congno
 */

const debtAgingService = require('./debtAgingService');
const geminiAccountingService = require('./geminiAccountingService');
const { getTelegramSettings, sendRawTelegramMessage, resolveBotConfig } = require('./telegramService');

function formatVnd(val) {
  const n = Number(val || 0);
  return `${Math.round(n).toLocaleString('vi-VN')} đ`;
}

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

/**
 * Tạo nội dung báo cáo tuổi nợ và nợ xấu gửi Telegram
 */
async function generateDebtAgingTelegramHtml(queryOptions = {}) {
  const report = debtAgingService.getDebtAgingAnalysis(queryOptions);
  const kpi = report.kpi_summary;
  const breakdown = kpi.aging_breakdown;
  const customers = report.customer_summary || [];

  const lines = [
    `📊 <b>[BÁO CÁO CÔNG NỢ &amp; TUỔI NỢ KHÁCH HÀNG]</b>`,
    `━━━━━━━━━━━━━━━━━━`,
    `📅 <b>Kỳ báo cáo:</b> <code>${escapeHtml(report.filter_period.from)}</code> ➔ <code>${escapeHtml(report.filter_period.to)}</code>`,
    `⏰ <b>Thời điểm trích xuất:</b> ${formatTimestamp()}`,
    ``,
    `💰 <b>TỔNG CÔNG NỢ PHẢI THU:</b> <b>${formatVnd(kpi.total_receivable)}</b>`,
    `👥 <b>Số khách hàng còn nợ:</b> <b>${kpi.debtor_customer_count}</b> khách (${kpi.unpaid_invoices_count} đơn)`,
    `⚠️ <b>Tổng nợ quá hạn (chậm trả):</b> <b>${formatVnd(kpi.total_overdue)}</b> (Chiếm <b>${kpi.overdue_percentage}%</b>)`,
    `🚨 <b>Rủi ro nợ xấu (&gt;60 ngày):</b> <b>${formatVnd(kpi.bad_debt_risk_amount)}</b> (${kpi.bad_debt_percentage}%)`,
    ``,
    `📈 <b>PHÂN BỔ 4 NHÓM TUỔI NỢ:</b>`,
    ` • 🟢 <b>0 - 15 ngày (Trong hạn):</b> ${formatVnd(breakdown.bucket_0_15.amount)} (${breakdown.bucket_0_15.percentage}%)`,
    ` • 🟡 <b>16 - 30 ngày (Quá hạn nhẹ):</b> ${formatVnd(breakdown.bucket_16_30.amount)} (${breakdown.bucket_16_30.percentage}%)`,
    ` • 🟠 <b>31 - 60 ngày (Cần nhắc nợ):</b> ${formatVnd(breakdown.bucket_31_60.amount)} (${breakdown.bucket_31_60.percentage}%)`,
    ` • 🔴 <b>&gt; 60 ngày (Nguy cơ nợ xấu):</b> ${formatVnd(breakdown.bucket_over_60.amount)} (${breakdown.bucket_over_60.percentage}%)`,
  ];

  // Top 5 khách nợ lâu nhất
  const topDebtors = customers.slice(0, 5);
  if (topDebtors.length > 0) {
    lines.push(``);
    lines.push(`🚨 <b>TOP KHÁCH CẦN THU HỒI NỢ GẤP:</b>`);
    topDebtors.forEach((c, i) => {
      lines.push(
        `${i + 1}. <b>${escapeHtml(c.customer_name)}</b> ${c.customer_phone ? `(<code>${escapeHtml(c.customer_phone)}</code>)` : ''}\n` +
        `   └ Nợ: <b>${formatVnd(c.total_remaining_debt)}</b> | Tuổi nợ: <b>${c.max_debt_days}</b> ngày | Rủi ro: <b>${c.risk_level.toUpperCase()}</b>`
      );
    });
  }

  // Tích hợp nhận định từ Trợ lý Gemini AI nếu đã cấu hình
  const aiCfg = geminiAccountingService.getGeminiConfig();
  if (aiCfg.isConfigured) {
    try {
      const aiRes = await geminiAccountingService.analyzeDebtHealth(queryOptions);
      if (aiRes && aiRes.ok && aiRes.analysis) {
        // Lấy 300 ký tự đầu tiên hoặc tóm tắt ngắn để không làm tràn tin nhắn Telegram
        const summarySnippet = aiRes.analysis.split('\n\n')[0] || aiRes.analysis.slice(0, 280);
        lines.push(``);
        lines.push(`🤖 <b>NHẬN ĐỊNH TỪ TRỢ LÝ AI (GEMINI):</b>`);
        lines.push(`<i>${escapeHtml(summarySnippet.slice(0, 350))}...</i>`);
      }
    } catch (_) {
      // Ignored nếu AI tạm bận
    }
  }

  lines.push(``);
  lines.push(`🏢 <i>Hệ thống Kế toán Bán Hàng POS Offline</i>`);
  return lines.join('\n');
}

/**
 * Gửi báo cáo tuổi nợ và nợ xấu về nhóm Telegram
 */
async function sendDebtAgingTelegramReport(queryOptions = {}, requester = '') {
  const settings = getTelegramSettings();
  if (!settings.enabled) {
    return { ok: false, error: 'Chức năng thông báo Telegram đang tắt trong Cài đặt.' };
  }

  const groupId = (settings.group_id || '').trim();
  if (!groupId) {
    return { ok: false, error: 'Chưa cấu hình ID Nhóm Telegram (Group Chat ID).' };
  }

  // Tìm bot khả dụng (ưu tiên bot_accounting, rồi bot_order_reports hoặc bot_stats hoặc bot bất kỳ có token)
  const botAccounting = settings.bots?.bot_accounting?.token;
  const botOrderReport = settings.bots?.bot_order_reports?.token;
  const botStats = settings.bots?.bot_stats?.token;
  const botConfig = resolveBotConfig ? resolveBotConfig('bot_accounting') : null;
  const token = botAccounting || botOrderReport || botStats || botConfig?.token || (Object.values(settings.bots || {}).find(b => b?.token)?.token);

  if (!token) {
    return { ok: false, error: 'Chưa cấu hình Token cho Bot Telegram báo cáo.' };
  }

  try {
    const messageHtml = await generateDebtAgingTelegramHtml(queryOptions);
    const result = await sendRawTelegramMessage(token, groupId, messageHtml);

    if (result && result.ok) {
      return {
        ok: true,
        message: 'Đã gửi báo cáo công nợ & tuổi nợ về nhóm Telegram thành công!',
        result: result.result,
      };
    }

    return {
      ok: false,
      error: result?.error || 'Không gửi được tin nhắn tới Telegram.',
    };
  } catch (err) {
    return {
      ok: false,
      error: err.message || 'Lỗi khi gửi báo cáo công nợ về Telegram.',
    };
  }
}

module.exports = {
  generateDebtAgingTelegramHtml,
  sendDebtAgingTelegramReport,
};
