import { useEffect, useRef, useState, useCallback } from 'react';
import { SYNC_UPDATED_EVENT } from './apiClient';

const DEFAULT_TICK_MS = 1000;

function nowMs() {
  return Date.now();
}

function formatLocalTime(ts, { withSeconds = true, withDate = false } = {}) {
  if (!ts) return '';
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return '';
  const opts = withSeconds
    ? { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }
    : { hour: '2-digit', minute: '2-digit', hour12: false };
  const time = date.toLocaleTimeString('vi-VN', opts);
  if (!withDate) return time;
  return `${date.toLocaleDateString('vi-VN')} ${time}`;
}

function tablesMatch(changedTables = [], watchedTables = []) {
  if (!watchedTables || watchedTables.length === 0) return true;
  if (!Array.isArray(changedTables) || changedTables.length === 0) return false;
  const watched = new Set(watchedTables.map(item => String(item || '').trim()).filter(Boolean));
  if (watched.size === 0) return true;
  return changedTables.some(table => watched.has(String(table || '').trim()));
}

/**
 * Returns the current wall-clock time in ms, refreshed on a configurable interval.
 * Defaults to 1 second so a header clock or "live" timestamp ticks naturally.
 */
export function useNowClock(tickMs = DEFAULT_TICK_MS) {
  const [now, setNow] = useState(nowMs);
  useEffect(() => {
    const interval = Math.max(250, Number(tickMs) || DEFAULT_TICK_MS);
    const id = window.setInterval(() => setNow(nowMs()), interval);
    return () => window.clearInterval(id);
  }, [tickMs]);
  return now;
}

/**
 * Tracks the last time any of the watched tables changed (in ms, local clock).
 * If `watchedTables` is empty/omitted, any sync event will update the value.
 *
 *   const lastSyncAt = useLastSyncAt(['customers', 'partners']);
 */
export function useLastSyncAt(watchedTables = []) {
  const [lastSyncAt, setLastSyncAt] = useState(0);
  const watchedRef = useRef(watchedTables);
  watchedRef.current = watchedTables;

  useEffect(() => {
    const handler = (event) => {
      const changedTables = event?.detail?.changedTables || event?.detail?.tables || [];
      if (!tablesMatch(changedTables, watchedRef.current)) return;
      setLastSyncAt(Number(event?.detail?.ts) || nowMs());
    };
    window.addEventListener(SYNC_UPDATED_EVENT, handler);
    return () => window.removeEventListener(SYNC_UPDATED_EVENT, handler);
  }, []);

  // Provide a manual updater for screens that want to mark "fresh" after their own fetch.
  const markFresh = useCallback((ts) => {
    setLastSyncAt(Number(ts) || nowMs());
  }, []);

  return [lastSyncAt, markFresh];
}

/**
 * Convenience hook: returns a formatted "HH:mm:ss" string for the live clock.
 */
export function useLiveClockText({ withSeconds = true, withDate = false, tickMs = DEFAULT_TICK_MS } = {}) {
  const now = useNowClock(tickMs);
  return formatLocalTime(now, { withSeconds, withDate });
}

export { formatLocalTime };