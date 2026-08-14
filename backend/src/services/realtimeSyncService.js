/**
 * KHA Realtime Sync Service
 * 
 * Quản lý các kết nối Server-Sent Events (SSE) để phát tín hiệu đồng bộ realtime
 * tới tất cả các tab và cửa sổ đang hoạt động.
 */
const { getAll } = require('../db/database');

const clients = new Map();
const MAX_CATCH_UP_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_CATCH_UP_ROWS = 1000;
let pingInterval = null;

function initialize() {
  // Gửi ping định kỳ 30 giây để giữ kết nối
  if (!pingInterval) {
    pingInterval = setInterval(() => {
      const message = `data: ${JSON.stringify({ type: 'ping', ts: Date.now() })}\n\n`;
      for (const client of clients.keys()) {
        try {
          client.write(message);
        } catch (_) {
          clients.delete(client);
        }
      }
    }, 30000);

    if (pingInterval.unref) {
      pingInterval.unref();
    }
  }
  console.log('[KHA REALTIME] Service initialized');
}

function registerClient(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  // Gửi gói tin kết nối thành công ban đầu
  res.write(`data: ${JSON.stringify({ type: 'connected', ts: Date.now() })}\n\n`);
  const accountId = Number(req.accountId || req.account?.id || req.user?.account_id);
  clients.set(res, Number.isFinite(accountId) && accountId > 0 ? accountId : null);

  // Xử lý catch-up nếu có lastSyncTime gửi kèm
  const lastSyncTime = req.query.lastSyncTime;
  if (lastSyncTime) {
    handleCatchUp(res, lastSyncTime, clients.get(res));
  }

  req.on('close', () => {
    clients.delete(res);
  });
}

function handleCatchUp(res, lastSyncTime, accountId) {
  const lastSyncMs = Number(lastSyncTime);
  if (Number.isNaN(lastSyncMs) || lastSyncMs <= 0) return;
  if (Date.now() - lastSyncMs > MAX_CATCH_UP_AGE_MS) {
    res.write(`data: ${JSON.stringify({ type: 'full-refresh-required', reason: 'catchup-window-expired', ts: Date.now() })}\n\n`);
    return;
  }

  try {
    // Lấy lịch sử thay đổi để quét các bảng đã được sửa sau thời điểm mất kết nối
    const history = getAll('edit_history', h => (
      (h.timestamp || 0) > lastSyncMs
      && (accountId == null || Number(h.account_id) === accountId)
    ), { skipAccountScope: true }).slice(0, MAX_CATCH_UP_ROWS + 1);
    if (history.length > MAX_CATCH_UP_ROWS) {
      res.write(`data: ${JSON.stringify({ type: 'full-refresh-required', reason: 'catchup-limit-exceeded', ts: Date.now() })}\n\n`);
      return;
    }
    if (history.length > 0) {
      const changedTables = Array.from(new Set(history.map(h => h.table).filter(Boolean)));
      if (changedTables.length > 0) {
        res.write(`data: ${JSON.stringify({
          type: 'sync-update',
          changedTables,
          reason: 'reconnect-catchup',
          ts: Date.now(),
          source: 'server-catch-up'
        })}\n\n`);
      }
    }
  } catch (err) {
    console.warn('[KHA REALTIME] Catch-up error:', err.message);
  }
}

function broadcastChangeEvent(changedTables, detail = {}) {
  if (!Array.isArray(changedTables) || changedTables.length === 0) return;

  const payload = {
    type: 'sync-update',
    changedTables,
    ts: Date.now(),
    sourceTabId: detail.sourceTabId || null,
    op: detail.op || null,
    id: detail.id || null,
    reason: detail.reason || 'data-change',
  };

  const message = `data: ${JSON.stringify(payload)}\n\n`;
  let sentCount = 0;

  for (const [client, accountId] of clients) {
    if (detail.accountId != null && Number(detail.accountId) !== Number(accountId)) continue;
    try {
      client.write(message);
      sentCount++;
    } catch (_) {
      clients.delete(client);
    }
  }

}

function shutdown() {
  if (pingInterval) {
    clearInterval(pingInterval);
    pingInterval = null;
  }
  for (const client of clients.keys()) {
    try {
      client.end();
    } catch (_) {}
  }
  clients.clear();
}

module.exports = {
  initialize,
  registerClient,
  broadcastChangeEvent,
  shutdown,
};
