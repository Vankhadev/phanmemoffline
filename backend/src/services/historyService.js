/**
 * KHA History & Conflict Detection Service
 * 
 * Quản lý lịch sử chỉnh sửa của các thực thể, phát hiện xung đột cập nhật
 * (Optimistic Concurrency Control) và thực hiện khôi phục dữ liệu.
 */
let dbModule = null;
let initialized = false;

function initialize(options = {}) {
  dbModule = options.dbModule;
  initialized = true;
  console.log('[KHA HISTORY] Service initialized');
}

/**
 * Ghi nhận lịch sử thay đổi của một bản ghi
 */
function recordChange(table, recordId, op, before, after, context = {}) {
  if (!initialized || !dbModule) return null;
  if (table === 'edit_history') return null; // Tránh đệ quy vô tận

  const timestamp = Date.now();
  const serverTimeStr = before?.updated_at || (after?.updated_at || new Date().toISOString());
  const clientTimeStr = context.clientUpdatedAt || null;

  let isConflict = false;
  if (op === 'update' && before?.updated_at && clientTimeStr) {
    const serverMs = new Date(before.updated_at).getTime();
    const clientMs = new Date(clientTimeStr).getTime();
    
    // Nếu thời điểm hiện tại trên server mới hơn thời điểm client tải về để sửa (+ 1000ms đệm do lệch đồng hồ/mạng)
    if (serverMs > clientMs + 1000) {
      isConflict = true;
    }
  }

  const historyEntry = {
    table,
    record_id: Number(recordId),
    op, // 'insert' | 'update' | 'delete' | 'restore'
    timestamp,
    user_id: context.userId || null,
    user_name: context.userName || 'Hệ thống',
    before: before ? JSON.parse(JSON.stringify(before)) : null,
    after: after ? JSON.parse(JSON.stringify(after)) : null,
    is_conflict: isConflict,
    client_updated_at: clientTimeStr,
    server_updated_at: serverTimeStr,
  };

  try {
    // Lưu vào bảng edit_history. Sử dụng tùy chọn skipHistory: true để tránh đệ quy.
    dbModule.insert('edit_history', historyEntry, { skipHistory: true, shouldSaveImmediately: true });

    // Giới hạn lịch sử tối đa 1000 bản ghi
    const historyList = dbModule.getAll('edit_history', null, { skipAccountScope: true }) || [];
    if (historyList.length > 1000) {
      const sorted = [...historyList].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
      const removeCount = sorted.length - 1000;
      for (let i = 0; i < removeCount; i++) {
        dbModule.remove('edit_history', sorted[i].id, { skipHistory: true, shouldSaveImmediately: false });
      }
      dbModule.saveDB();
    }

    if (isConflict) {
      console.warn(`[KHA CONFLICT] Detected conflict on table=${table} id=${recordId}. Client time: ${clientTimeStr}, Server current: ${serverTimeStr}`);
    }

    return historyEntry;
  } catch (err) {
    console.error('[KHA HISTORY] Failed to record change history:', err.message);
    return null;
  }
}

/**
 * Khôi phục bản ghi về một phiên bản lịch sử
 */
function restoreVersion(historyId, context = {}) {
  if (!initialized || !dbModule) throw new Error('History service is not initialized');

  const entry = dbModule.getOne('edit_history', h => h.id === Number(historyId), { skipAccountScope: true });
  if (!entry) {
    throw new Error(`Không tìm thấy bản ghi lịch sử có ID: ${historyId}`);
  }

  const { table, record_id: recordId, before, op } = entry;

  try {
    if (op === 'insert') {
      // Khôi phục của lệnh insert ban đầu → Xóa bản ghi đã tạo
      dbModule.remove(table, recordId);
      console.log(`[KHA HISTORY] Restored insert: Removed record table=${table} id=${recordId}`);
    } else if (op === 'update' || op === 'delete' || op === 'restore') {
      // Khôi phục của lệnh update/delete → Ghi lại dữ liệu trước đó
      const existing = dbModule.getOne(table, r => r.id === recordId, { skipAccountScope: true });
      const nowTimeStr = new Date().toISOString();

      if (existing) {
        // Nếu bản ghi hiện tại vẫn tồn tại -> Cập nhật ngược lại dữ liệu cũ
        dbModule.update(table, recordId, { ...before, updated_at: nowTimeStr });
        console.log(`[KHA HISTORY] Restored update: Reverted record table=${table} id=${recordId} to previous state`);
      } else {
        // Nếu bản ghi đã bị xóa (soft hoặc hard delete) -> Chèn lại dữ liệu cũ
        dbModule.insert(table, { ...before, id: recordId, updated_at: nowTimeStr });
        console.log(`[KHA HISTORY] Restored delete: Re-inserted record table=${table} id=${recordId}`);
      }
    }

    // Ghi nhận sự kiện khôi phục này vào lịch sử
    recordChange(table, recordId, 'restore', null, before, context);
    return true;
  } catch (err) {
    console.error(`[KHA HISTORY] Failed to restore version historyId=${historyId}:`, err.message);
    throw err;
  }
}

module.exports = {
  initialize,
  recordChange,
  restoreVersion,
};
