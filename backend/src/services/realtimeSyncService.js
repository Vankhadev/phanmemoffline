/**
 * KHA Realtime Sync Service
 * 
 * Quản lý các kết nối Server-Sent Events (SSE) để phát tín hiệu đồng bộ realtime
 * tới tất cả các tab và cửa sổ đang hoạt động.
 */
const { getAll } = require('../db/database');

const clients = new Set();
let pingInterval = null;

function initialize() {
  // Gửi ping định kỳ 30 giây để giữ kết nối
  if (!pingInterval) {
    pingInterval = setInterval(() => {
      const message = `data: ${JSON.stringify({ type: 'ping', ts: Date.now() })}\n\n`;
      for (const client of clients) {
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
    'Access-Control-Allow-Origin': '*',
  });

  // Gửi gói tin kết nối thành công ban đầu
  res.write(`data: ${JSON.stringify({ type: 'connected', ts: Date.now() })}\n\n`);
  clients.add(res);

  // Xử lý catch-up nếu có lastSyncTime gửi kèm
  const lastSyncTime = req.query.lastSyncTime;
  if (lastSyncTime) {
    handleCatchUp(res, lastSyncTime);
  }

  req.on('close', () => {
    clients.delete(res);
  });
}

function handleCatchUp(res, lastSyncTime) {
  const lastSyncMs = Number(lastSyncTime);
  if (Number.isNaN(lastSyncMs) || lastSyncMs <= 0) return;

  try {
    // Lấy lịch sử thay đổi để quét các bảng đã được sửa sau thời điểm mất kết nối
    const history = getAll('edit_history', h => (h.timestamp || 0) > lastSyncMs, { skipAccountScope: true });
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
        console.log(`[KHA REALTIME] Sent catch-up sync for tables: ${changedTables.join(', ')}`);
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

  for (const client of clients) {
    try {
      client.write(message);
      sentCount++;
    } catch (_) {
      clients.delete(client);
    }
  }

  if (sentCount > 0) {
    console.log(`[KHA REALTIME] Broadcast changes on [${changedTables.join(', ')}] to ${sentCount} client(s)`);
  }
}

function shutdown() {
  if (pingInterval) {
    clearInterval(pingInterval);
    pingInterval = null;
  }
  for (const client of clients) {
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
