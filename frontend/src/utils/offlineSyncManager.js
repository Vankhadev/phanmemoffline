/**
 * offlineSyncManager.js
 * Quản lý hàng đợi đơn hàng ngoại tuyến (Offline Pending Orders),
 * bộ đệm sản phẩm (Catalog Cache), kiểm tra kết nối LAN máy chủ PC,
 * và điều phối tự động / thủ công đồng bộ đơn hàng về máy chủ PC (Auto & Manual Sync).
 * 
 * Vankha Team Standard:
 * - Không mất dữ liệu (Zero Data Loss - Persistent in localStorage)
 * - Chống trùng lặp đơn (Idempotency với client_order_id)
 * - Không rò rỉ dữ liệu (Zero Data Leak - Local LAN only)
 */

import { apiJsonChecked, resolveApiUrl } from './apiClient';
import { broadcastSyncUpdate } from './crossTabSync';
import { generateClientOrderId } from './clientOrderId';

export const PENDING_ORDERS_KEY = 'kha_pending_orders';
export const OFFLINE_CATALOG_KEY_PREFIX = 'kha_offline_catalog_';
export const PENDING_ORDERS_CHANGED_EVENT = 'kha-pending-orders-changed';
export const SYNC_STATUS_CHANGED_EVENT = 'kha-sync-status-changed';

let isSyncing = false;
let isServerOnline = true;
let autoSyncInitialized = false;
let lastServerCheckTime = 0;

/**
 * Lấy danh sách các đơn hàng đang chờ đồng bộ từ localStorage
 */
export function getPendingOrders() {
  try {
    if (typeof window === 'undefined') return [];
    const raw = window.localStorage.getItem(PENDING_ORDERS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.warn('[OfflineSync] Lỗi đọc pending orders:', err);
    return [];
  }
}

/**
 * Cập nhật danh sách đơn hàng chờ đồng bộ
 */
export function setPendingOrders(orders = []) {
  try {
    if (typeof window === 'undefined') return;
    const safeList = Array.isArray(orders) ? orders.slice(0, 200) : [];
    window.localStorage.setItem(PENDING_ORDERS_KEY, JSON.stringify(safeList));
    dispatchPendingOrdersChanged(safeList);
  } catch (err) {
    console.error('[OfflineSync] Lỗi ghi pending orders:', err);
  }
}

/**
 * Thêm một đơn hàng mới vào hàng đợi offline
 */
export function addPendingOrder(order = {}) {
  const current = getPendingOrders();
  const clientOrderId = order.client_order_id || generateClientOrderId();
  const invoiceCode = order.invoice_code || `OFFLINE_${Date.now().toString(36).toUpperCase()}`;

  const offlineOrder = {
    ...order,
    id: order.id || clientOrderId,
    client_order_id: clientOrderId,
    invoice_code: invoiceCode,
    _isOffline: true,
    status: order.status || 'pending',
    created_at: order.created_at || new Date().toISOString(),
    payload: {
      ...(order.payload || order),
      client_order_id: clientOrderId,
      invoice_code: invoiceCode,
    },
  };

  // Kiểm tra chống trùng lặp trong hàng đợi
  const exists = current.some(
    o => o.client_order_id === clientOrderId || o.invoice_code === invoiceCode
  );

  const updated = exists ? current : [offlineOrder, ...current];
  setPendingOrders(updated);
  return offlineOrder;
}

/**
 * Xóa đơn hàng khỏi hàng đợi sau khi đã đồng bộ thành công lên máy chủ
 */
export function removePendingOrder(idOrCode) {
  if (!idOrCode) return;
  const current = getPendingOrders();
  const filtered = current.filter(
    o => o.client_order_id !== idOrCode &&
         o.invoice_code !== idOrCode &&
         o.id !== idOrCode &&
         o.payload?.client_order_id !== idOrCode
  );
  if (filtered.length !== current.length) {
    setPendingOrders(filtered);
  }
}

/**
 * Xóa toàn bộ hàng đợi (chỉ dùng khi reset hoặc sau khi xác nhận)
 */
export function clearPendingOrders() {
  setPendingOrders([]);
}

/**
 * Bắn sự kiện thay đổi số lượng đơn chờ đồng bộ
 */
function dispatchPendingOrdersChanged(orders = getPendingOrders()) {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(
      new CustomEvent(PENDING_ORDERS_CHANGED_EVENT, {
        detail: {
          count: orders.length,
          orders,
          ts: Date.now(),
        },
      })
    );
  } catch (_) {}
}

/**
 * Bắn sự kiện thay đổi trạng thái đồng bộ
 */
function dispatchSyncStatusChanged(status = {}) {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(
      new CustomEvent(SYNC_STATUS_CHANGED_EVENT, {
        detail: {
          isSyncing,
          isServerOnline,
          pendingCount: getPendingOrders().length,
          ...status,
          ts: Date.now(),
        },
      })
    );
  } catch (_) {}
}

/**
 * Kiểm tra kết nối tới máy chủ PC cửa hàng (LAN IP: 192.168.1.8 hoặc localhost)
 */
export async function checkServerReachable(timeoutMs = 2500) {
  if (typeof window === 'undefined') return false;
  
  // Nếu trình duyệt báo hoàn toàn mất mạng (Airplane mode / không có sóng)
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    isServerOnline = false;
    dispatchSyncStatusChanged({ isServerOnline: false });
    return false;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Endpoint /api/mobile/network-info là public và phản hồi cực nhanh
    const url = resolveApiUrl('/mobile/network-info');
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'Cache-Control': 'no-cache' },
    });

    clearTimeout(timer);
    const reachable = response.ok;
    isServerOnline = reachable;
    lastServerCheckTime = Date.now();
    dispatchSyncStatusChanged({ isServerOnline });
    return reachable;
  } catch (err) {
    clearTimeout(timer);
    isServerOnline = false;
    lastServerCheckTime = Date.now();
    dispatchSyncStatusChanged({ isServerOnline: false });
    return false;
  }
}

/**
 * Lưu bộ đệm danh mục ngoại tuyến (Sản phẩm, Khách hàng, Nhóm danh mục, Combo)
 */
export function cacheCatalogData(type, data) {
  try {
    if (typeof window === 'undefined' || !type) return;
    const key = `${OFFLINE_CATALOG_KEY_PREFIX}${type}`;
    const payload = {
      cached_at: Date.now(),
      data: Array.isArray(data) ? data : [],
    };
    window.localStorage.setItem(key, JSON.stringify(payload));
  } catch (_) {}
}

/**
 * Đọc bộ đệm danh mục ngoại tuyến
 */
export function getCachedCatalogData(type) {
  try {
    if (typeof window === 'undefined' || !type) return [];
    const key = `${OFFLINE_CATALOG_KEY_PREFIX}${type}`;
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.data) ? parsed.data : [];
  } catch (_) {
    return [];
  }
}

/**
 * Tìm kiếm sản phẩm từ bộ nhớ đệm khi ở chế độ ngoại tuyến (4G / ngoài quán)
 */
export function searchOfflineProducts(query = '', { categoryId = null, limit = 50 } = {}) {
  const allProducts = getCachedCatalogData('products');
  if (!allProducts || allProducts.length === 0) return [];

  const q = String(query || '').trim().toLowerCase();

  const filtered = allProducts.filter(product => {
    if (!product || product.active === 0 || product.deleted === true) return false;
    if (categoryId && String(product.default_category_id || product.category_id) !== String(categoryId)) {
      return false;
    }
    if (!q) return true;

    const name = String(product.name || '').toLowerCase();
    const sku = String(product.sku || '').toLowerCase();
    const barcode = String(product.barcode || '').toLowerCase();
    const cat = String(product.category || '').toLowerCase();

    if (name.includes(q) || sku.includes(q) || barcode.includes(q) || cat.includes(q)) {
      return true;
    }

    // Tìm trong biến thể
    if (Array.isArray(product.variants)) {
      return product.variants.some(v =>
        String(v.name || '').toLowerCase().includes(q) ||
        String(v.sku || '').toLowerCase().includes(q) ||
        String(v.barcode || '').toLowerCase().includes(q)
      );
    }
    return false;
  });

  return filtered.slice(0, limit);
}

/**
 * ĐỒNG BỘ ĐƠN HÀNG CỐT LÕI (Core Sync Engine)
 * Gửi từng đơn trong pending orders lên máy tính chủ PC
 */
export async function syncPendingOrders({ onProgress = null, force = false } = {}) {
  if (isSyncing) {
    return { inProgress: true, message: 'Hệ thống đang trong quá trình đồng bộ.' };
  }

  const pending = getPendingOrders();
  if (pending.length === 0) {
    return { success: true, count: 0, total: 0, message: 'Không có đơn hàng nào cần đồng bộ.' };
  }

  // 1. Kiểm tra kết nối máy chủ trước khi đồng bộ
  if (!force) {
    const isReachable = await checkServerReachable(2500);
    if (!isReachable) {
      return {
        success: false,
        reason: 'unreachable',
        pendingCount: pending.length,
        message: 'Chưa kết nối được máy chủ PC của quán (192.168.1.8). Đơn hàng vẫn được lưu an toàn trên máy.',
      };
    }
  }

  isSyncing = true;
  dispatchSyncStatusChanged({ isSyncing: true });

  const total = pending.length;
  let syncedCount = 0;
  let errorCount = 0;
  const errors = [];
  const syncedOrders = [];

  try {
    for (let i = 0; i < pending.length; i++) {
      const order = pending[i];
      if (typeof onProgress === 'function') {
        onProgress({ current: i + 1, total, order });
      }

      const clientOrderId = order.client_order_id || order.payload?.client_order_id || generateClientOrderId();
      const payload = {
        ...(order.payload || order),
        client_order_id: clientOrderId,
        order_source: 'mobile_sync',
      };

      try {
        const response = await apiJsonChecked('/invoices', {
          method: 'POST',
          body: payload,
        }, 'Không thể đồng bộ đơn hàng lên máy chủ.');

        // Thành công hoặc Idempotent duplicate: xóa khỏi pending
        removePendingOrder(clientOrderId);
        syncedCount++;
        syncedOrders.push({
          client_order_id: clientOrderId,
          invoice_code: response?.invoice_code || order.invoice_code,
          invoice_id: response?.invoice_id || null,
          idempotent: response?.idempotent === true,
        });

        // Bắn sự kiện đơn hàng đã tạo thành công
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('kha-order-created', {
              detail: {
                ...order,
                id: response?.invoice_id || clientOrderId,
                invoice_code: response?.invoice_code || order.invoice_code,
                _synced: true,
              },
            })
          );
        }
      } catch (err) {
        console.warn(`[OfflineSync] Lỗi khi đồng bộ đơn ${order.invoice_code || clientOrderId}:`, err);

        // Nếu lỗi là do đơn đã tồn tại (idempotency conflict 409) -> cũng coi như đã có trên PC
        if (err?.status === 409 || err?.message?.includes('tồn tại') || err?.code === 'IDEMPOTENCY_CONFLICT') {
          removePendingOrder(clientOrderId);
          syncedCount++;
        } else {
          errorCount++;
          errors.push({ order, error: err.message });
          // Cập nhật lỗi vào order để hiển thị cho nhân viên, không xóa bỏ để tránh mất đơn
          const updated = getPendingOrders().map(o =>
            (o.client_order_id === clientOrderId)
              ? { ...o, last_sync_error: err.message, last_sync_time: new Date().toISOString() }
              : o
          );
          setPendingOrders(updated);
        }
      }
    }

    // Nếu có đơn đồng bộ thành công, broadcast cập nhật bảng invoices, products trên PC
    if (syncedCount > 0) {
      try {
        broadcastSyncUpdate({
          reason: 'offline-orders-synced',
          changedTables: ['invoices', 'invoice_details', 'products', 'daily_stats'],
        });
      } catch (_) {}
    }

    return {
      success: errorCount === 0,
      count: syncedCount,
      total,
      errors,
      syncedOrders,
      message: errorCount === 0
        ? `Đồng bộ thành công ${syncedCount}/${total} đơn hàng lên máy tính chủ PC!`
        : `Đã đồng bộ ${syncedCount} đơn, còn ${errorCount} đơn gặp lỗi.`,
    };
  } finally {
    isSyncing = false;
    dispatchSyncStatusChanged({ isSyncing: false });
  }
}

/**
 * Tự động đồng bộ ngầm khi phát hiện máy chủ (Auto-Sync)
 */
async function triggerAutoSyncIfPending() {
  if (isSyncing) return;
  const pending = getPendingOrders();
  if (pending.length === 0) return;

  const isReachable = await checkServerReachable(2000);
  if (isReachable) {
    console.log(`[OfflineSync] Tự động đồng bộ ${pending.length} đơn hàng ngoại tuyến lên máy chủ PC...`);
    const result = await syncPendingOrders({ force: true });
    if (result.count > 0 && typeof window !== 'undefined') {
      try {
        window.dispatchEvent(
          new CustomEvent('kha-auto-sync-notification', {
            detail: {
              syncedCount: result.count,
              message: `🎉 Đã tự động đồng bộ ${result.count} đơn hàng lên máy tính chủ PC!`,
            },
          })
        );
      } catch (_) {}
    }
  }
}

/**
 * Khởi tạo tiến trình Auto-Sync nền (chỉ chạy 1 lần duy nhất trong App)
 */
export function initOfflineAutoSync() {
  if (autoSyncInitialized || typeof window === 'undefined') return;
  autoSyncInitialized = true;

  // 1. Lắng nghe sự kiện trình duyệt kết nối lại mạng (Wi-Fi)
  window.addEventListener('online', () => {
    setTimeout(() => {
      triggerAutoSyncIfPending();
    }, 1500);
  });

  // 2. Lắng nghe khi tab active trở lại (nhân viên mở lại app)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      const now = Date.now();
      if (now - lastServerCheckTime > 10000) {
        triggerAutoSyncIfPending();
      }
    }
  });

  // 3. Heartbeat định kỳ mỗi 20 giây nếu có đơn pending
  setInterval(() => {
    const pending = getPendingOrders();
    if (pending.length > 0 && !isSyncing) {
      triggerAutoSyncIfPending();
    }
  }, 20000);

  // 4. Kiểm tra ngay khi khởi động app
  setTimeout(() => {
    checkServerReachable(1500).then(online => {
      if (online) triggerAutoSyncIfPending();
    });
  }, 2500);
}
