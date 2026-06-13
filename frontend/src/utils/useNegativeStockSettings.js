import { useCallback, useEffect, useState } from 'react';
import { getApiErrorMessage, settingsApi, SYNC_UPDATED_EVENT } from './apiClient';
import {
  NEGATIVE_STOCK_SETTINGS_UPDATED_EVENT,
  cacheNegativeStockSettings,
  normalizeNegativeStockSettings,
  readCachedNegativeStockSettings,
} from './negativeStock';

export default function useNegativeStockSettings(options = {}) {
  const shouldLoad = options.load !== false;
  const [settings, setSettings] = useState(() => readCachedNegativeStockSettings() || normalizeNegativeStockSettings());
  const [loading, setLoading] = useState(shouldLoad);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await settingsApi.get();
      const normalized = cacheNegativeStockSettings(data);
      setSettings(normalized);
      setError('');
      return normalized;
    } catch (err) {
      const message = getApiErrorMessage(err?.data || err, err?.message || 'Không thể tải cài đặt xuất âm tồn kho.');
      const cached = readCachedNegativeStockSettings();
      const fallback = cached || normalizeNegativeStockSettings();
      setSettings(fallback);
      setError(message);
      return fallback;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (shouldLoad) {
      refresh();
      return undefined;
    }
    setLoading(false);
    return undefined;
  }, [refresh, shouldLoad]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handleUpdated = (event) => {
      const nextSettings = event?.detail?.settings || event?.detail || readCachedNegativeStockSettings() || normalizeNegativeStockSettings();
      setSettings(normalizeNegativeStockSettings(nextSettings));
      setError('');
    };
    window.addEventListener(NEGATIVE_STOCK_SETTINGS_UPDATED_EVENT, handleUpdated);
    return () => window.removeEventListener(NEGATIVE_STOCK_SETTINGS_UPDATED_EVENT, handleUpdated);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handleSyncUpdated = (event) => {
      const detail = event?.detail || {};
      if (detail.sourceTabId === window.__vankhaTabId) return;
      const changedTables = detail.changedTables || detail.tables || [];
      if (changedTables.includes('settings')) {
        refresh();
      }
    };
    window.addEventListener(SYNC_UPDATED_EVENT, handleSyncUpdated);
    return () => window.removeEventListener(SYNC_UPDATED_EVENT, handleSyncUpdated);
  }, [refresh]);

  return { settings, loading, error, refresh };
}
