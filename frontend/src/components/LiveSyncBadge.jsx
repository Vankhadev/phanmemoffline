import { useMemo } from 'react';
import { useLastSyncAt, useNowClock, formatLocalTime } from '../utils/useLiveSyncClock';

function describeRelative(now, ts) {
  if (!ts) return '';
  const diffMs = Math.max(0, now - ts);
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 5) return 'vừa xong';
  if (seconds < 60) return `${seconds} giây trước`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  return `${days} ngày trước`;
}

/**
 * Shows the current wall-clock time and, when data has changed, when the most
 * recent sync happened. Both values are driven by the user's local machine
 * clock so the UI always matches what the operator sees in their OS taskbar.
 *
 *   <LiveSyncBadge tables={['customers', 'partners']} label="Khách hàng" />
 */
export default function LiveSyncBadge({
  tables = [],
  label = '',
  showClock = true,
  showSyncRelative = true,
  showSyncTime = true,
  className = '',
}) {
  const [lastSyncAt] = useLastSyncAt(tables);
  const now = useNowClock(1000);
  const clockText = useMemo(() => formatLocalTime(now, { withSeconds: true }), [now]);
  const syncText = useMemo(() => (lastSyncAt ? formatLocalTime(lastSyncAt, { withSeconds: true }) : ''), [lastSyncAt]);
  const relative = useMemo(() => describeRelative(now, lastSyncAt), [now, lastSyncAt]);

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white/80 px-2.5 py-1 text-[11px] font-medium text-gray-600 shadow-sm ${className}`}
      title={lastSyncAt ? `Cập nhật lúc ${formatLocalTime(lastSyncAt, { withSeconds: true, withDate: true })}` : 'Chưa có thay đổi mới'}
    >
      {showClock && (
        <span className="inline-flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" aria-hidden="true" />
          <span className="tabular-nums text-gray-800">{clockText}</span>
        </span>
      )}
      {(showSyncRelative || showSyncTime) && (
        <span className="inline-flex items-center gap-1 text-gray-500">
          <span aria-hidden="true">·</span>
          <span>{label ? `${label}:` : 'Cập nhật:'}</span>
          {lastSyncAt ? (
            <span className="tabular-nums">
              {showSyncTime ? syncText : ''}
              {showSyncTime && showSyncRelative ? ' ' : ''}
              {showSyncRelative ? <span className="text-gray-400">({relative})</span> : null}
            </span>
          ) : (
            <span className="text-gray-400">chưa có</span>
          )}
        </span>
      )}
    </span>
  );
}