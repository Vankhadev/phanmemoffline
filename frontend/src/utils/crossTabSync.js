import { SYNC_UPDATED_EVENT } from './apiClient';

const CROSS_TAB_SYNC_CHANNEL = 'vankha-cross-tab-sync';
const CROSS_TAB_SYNC_STORAGE_KEY = 'vankha.cross-tab-sync.payload';
const TAB_ID = `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

let bridgeInstalled = false;
let broadcastChannel = null;

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
  window.dispatchEvent(new CustomEvent(SYNC_UPDATED_EVENT, {
    detail: {
      ...normalizedDetail,
      __crossTabSyncRemote: remote,
      __crossTabSyncSkipBroadcast: skipBroadcast,
    },
  }));
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

  const payload = {
    type: 'sync-update',
    sourceTabId: TAB_ID,
    ts: Date.now(),
    detail: normalizeSyncDetail(detail),
  };

  const channel = ensureBroadcastChannel();
  if (channel) {
    channel.postMessage(payload);
  }

  try {
    window.localStorage.setItem(CROSS_TAB_SYNC_STORAGE_KEY, JSON.stringify(payload));
    window.localStorage.removeItem(CROSS_TAB_SYNC_STORAGE_KEY);
  } catch (_) {
    // Ignore storage failures in locked-down/private contexts.
  }
}

function handleIncomingPayload(payload) {
  if (!payload || payload.type !== 'sync-update') return;
  if (payload.sourceTabId === TAB_ID) return;

  dispatchSyncUpdated({
    ...payload.detail,
    sourceTabId: payload.sourceTabId,
    ts: payload.ts || payload.detail?.ts || Date.now(),
  }, {
    remote: true,
    skipBroadcast: true,
  });
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
}
