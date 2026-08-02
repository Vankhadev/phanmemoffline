import { SYNC_BROADCAST_REQUEST_EVENT, SYNC_UPDATED_EVENT, resolveApiUrl } from './apiClient';
import { emitGlobalSyncEvents } from './eventEmitter';

const CROSS_TAB_SYNC_CHANNEL = 'vankha-cross-tab-sync';
const CROSS_TAB_SYNC_STORAGE_KEY = 'vankha.cross-tab-sync.payload';
const TAB_ID = `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

if (typeof window !== 'undefined') {
  window.__vankhaTabId = TAB_ID;
}

let bridgeInstalled = false;
let broadcastChannel = null;
let lastPostedSignature = '';
let lastPostedAt = 0;
let sseConnection = null;
let reconnectTimer = null;
let reconnectDelay = 1000;
const seenEventIds = new Map();

function isDuplicateIncomingEvent(eventId) {
  if (!eventId) return false;
  const now = Date.now();
  for (const [key, timestamp] of seenEventIds) {
    if (now - timestamp > 60_000) seenEventIds.delete(key);
  }
  if (seenEventIds.has(eventId)) return true;
  seenEventIds.set(eventId, now);
  return false;
}

function isBrowserRuntime() {
  return typeof window !== 'undefined';
}

function normalizeChangedTables(value = []) {
  const list = Array.isArray(value) ? value : [value];
  return Array.from(new Set(list.map(item => String(item || '').trim()).filter(Boolean)));
}

function normalizeSyncDetail(detail = {}) {
  const changedTables = normalizeChangedTables(detail.changedTables || detail.tables || []);
  return {
    ...detail,
    changedTables,
    tables: changedTables,
    sourceTabId: detail.sourceTabId || TAB_ID,
    ts: Number(detail.ts) || Date.now(),
  };
}

function dispatchSyncUpdated(detail, { remote = false, skipBroadcast = false } = {}) {
  if (!isBrowserRuntime()) return;
  const normalizedDetail = normalizeSyncDetail(detail);
  const op = detail.op || normalizedDetail.op || null;
  const id = detail.id || normalizedDetail.id || null;

  const mergedDetail = {
    ...normalizedDetail,
    op,
    id,
    __crossTabSyncRemote: remote,
    __crossTabSyncSkipBroadcast: skipBroadcast,
  };

  window.dispatchEvent(new CustomEvent(SYNC_UPDATED_EVENT, {
    detail: mergedDetail,
  }));

  // Emit on our Global Event System (EventEmitter)
  emitGlobalSyncEvents(mergedDetail.changedTables, mergedDetail.op, mergedDetail);
}

function ensureBroadcastChannel() {
  if (!isBrowserRuntime() || typeof BroadcastChannel === 'undefined') return null;
  if (!broadcastChannel) {
    broadcastChannel = new BroadcastChannel(CROSS_TAB_SYNC_CHANNEL);
  }
  return broadcastChannel;
}

function postCrossTabPayload(detail = {}) {
  if (!isBrowserRuntime()) return;
  const normalizedDetail = normalizeSyncDetail(detail);
  const signature = [
    normalizeChangedTables(normalizedDetail.changedTables).sort().join(','),
    String(normalizedDetail.reason || ''),
    String(normalizedDetail.method || ''),
    String(normalizedDetail.path || ''),
  ].join('|');
  const now = Date.now();
  if (signature && signature === lastPostedSignature && now - lastPostedAt < 150) return;
  lastPostedSignature = signature;
  lastPostedAt = now;

  const payload = {
    type: 'sync-update',
    eventId: `${TAB_ID}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    sourceTabId: TAB_ID,
    ts: Date.now(),
    detail: normalizedDetail,
  };

  const channel = ensureBroadcastChannel();
  if (channel) {
    channel.postMessage(payload);
  } else {
    try {
      window.localStorage.setItem(CROSS_TAB_SYNC_STORAGE_KEY, JSON.stringify(payload));
      window.localStorage.removeItem(CROSS_TAB_SYNC_STORAGE_KEY);
    } catch (_) {
      // Ignore storage failures in locked-down/private contexts.
    }
  }
}

function handleIncomingPayload(payload) {
  if (!payload || payload.type !== 'sync-update') return;
  if (payload.sourceTabId === TAB_ID) return;
  if (isDuplicateIncomingEvent(payload.eventId)) return;

  dispatchSyncUpdated({
    ...payload.detail,
    sourceTabId: payload.sourceTabId,
    ts: payload.ts || payload.detail?.ts || Date.now(),
  }, {
    remote: true,
    skipBroadcast: true,
  });
}

function connectRealtimeSyncSSE() {
  if (!isBrowserRuntime() || typeof EventSource === 'undefined') return;
  if (sseConnection) return;

  const lastSyncTime = window.localStorage.getItem('kha_last_sync_time') || Date.now();
  const sseUrl = resolveApiUrl(`/realtime/sync?lastSyncTime=${lastSyncTime}`);
  const source = new EventSource(sseUrl);

  source.onopen = () => {
    reconnectDelay = 1000;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  source.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.type === 'ping') return;

      if (payload.type === 'connected') {
        window.localStorage.setItem('kha_last_sync_time', String(payload.ts));
        return;
      }

      if (payload.type === 'sync-update') {
        window.localStorage.setItem('kha_last_sync_time', String(payload.ts));

        if (payload.sourceTabId === TAB_ID) return;

        dispatchSyncUpdated({
          changedTables: payload.changedTables,
          reason: payload.reason || 'sse-sync',
          ts: payload.ts,
          sourceTabId: payload.sourceTabId,
          op: payload.op,
          id: payload.id,
        }, {
          remote: true,
          skipBroadcast: true,
        });
      }
    } catch (err) {
      console.warn('[KHA SSE] Message handle error:', err);
    }
  };

  source.onerror = () => {
    source.close();
    sseConnection = null;
    if (!reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        reconnectDelay = Math.min(reconnectDelay * 2, 30000);
        connectRealtimeSyncSSE();
      }, reconnectDelay);
    }
  };

  sseConnection = source;
}

export function broadcastSyncUpdate(detail = {}) {
  dispatchSyncUpdated(detail, { skipBroadcast: true });
  postCrossTabPayload(detail);
}

export function installCrossTabSyncBridge() {
  if (bridgeInstalled || !isBrowserRuntime()) return;
  bridgeInstalled = true;

  const channel = ensureBroadcastChannel();
  if (channel) {
    channel.addEventListener('message', (event) => {
      handleIncomingPayload(event.data);
    });
  }

  window.addEventListener('storage', (event) => {
    if (event.key !== CROSS_TAB_SYNC_STORAGE_KEY || !event.newValue) return;
    try {
      handleIncomingPayload(JSON.parse(event.newValue));
    } catch (_) {
      // Ignore malformed payloads.
    }
  });

  window.addEventListener(SYNC_UPDATED_EVENT, (event) => {
    const detail = event.detail || {};
    if (detail.__crossTabSyncSkipBroadcast) return;
    if (detail.sourceTabId === TAB_ID) return;
    postCrossTabPayload(detail);
  });

  window.addEventListener(SYNC_BROADCAST_REQUEST_EVENT, (event) => {
    postCrossTabPayload(event.detail || {});
  });

  connectRealtimeSyncSSE();
}
