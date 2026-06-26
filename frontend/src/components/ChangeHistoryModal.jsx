import React, { useState, useEffect } from 'react';
import { X, Clock, User, ArrowRight, RotateCcw, AlertTriangle, CheckCircle } from 'lucide-react';
import { resolveApiUrl } from '../utils/apiClient';

export default function ChangeHistoryModal({ isOpen, onClose, tableName, recordId, onRestoreSuccess }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [restoringId, setRestoringId] = useState(null);

  useEffect(() => {
    if (isOpen) {
      fetchHistory();
    }
  }, [isOpen, tableName, recordId]);

  const fetchHistory = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(resolveApiUrl(`/history/${tableName}/${recordId}`));
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      setHistory(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('[KHA HISTORY UI] Load error:', err);
      setError('Không thể tải lịch sử chỉnh sửa bản ghi này.');
    } finally {
      setLoading(false);
    }
  };

  const handleRestore = async (historyId) => {
    if (!confirm('Bản c? ch?c chọn mu?n kh?i ph?c b?n ghi v? phi?n b?n n?y không?')) return;
    
    setRestoringId(historyId);
    try {
      const res = await fetch(resolveApiUrl(`/history/restore/${historyId}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || 'Restore failed');
      }
      alert('✅ Khôi phục dữ liệu thành công!');
      onRestoreSuccess?.();
      onClose();
    } catch (err) {
      alert(`⚠️ Lỗi khôi phục: ${err.message}`);
    } finally {
      setRestoringId(null);
    }
  };

  if (!isOpen) return null;

  // Format date helper
  const formatTime = (ts) => {
    if (!ts) return 'Không rõ';
    return new Date(ts).toLocaleString('vi-VN');
  };

  // Helper render operations
  const getOpLabel = (op) => {
    switch (op) {
      case 'insert': return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-100 text-green-800">Thêm mới</span>;
      case 'update': return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800">Cập nhật</span>;
      case 'delete': return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-800">Xóa</span>;
      case 'restore': return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-800">Khôi phục</span>;
      default: return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 text-gray-800">{op}</span>;
    }
  };

  // Helper render value
  const renderValue = (val) => {
    if (val === null || val === undefined) return <span className="text-gray-400 font-normal italic">Trống</span>;
    if (typeof val === 'object') return <span className="text-gray-500 font-mono text-[11px] block whitespace-pre-wrap">{JSON.stringify(val, null, 1)}</span>;
    if (typeof val === 'boolean') return val ? 'Có' : 'Không';
    return <span className="font-semibold text-gray-800">{String(val)}</span>;
  };

  // Helper to diff keys between before and after states
  const getDiffs = (before, after) => {
    if (!before && !after) return [];
    const diffList = [];
    
    // Ignore system fields
    const ignoreFields = ['id', 'created_at', 'updated_at', 'deleted_at', 'account_id', 'parent_id', 'active'];
    
    const allKeys = new Set([
      ...Object.keys(before || {}),
      ...Object.keys(after || {})
    ]);

    for (const key of allKeys) {
      if (ignoreFields.includes(key)) continue;

      const beforeVal = before?.[key];
      const afterVal = after?.[key];

      // Deep compare simplified
      const beforeStr = beforeVal !== undefined ? JSON.stringify(beforeVal) : '';
      const afterStr = afterVal !== undefined ? JSON.stringify(afterVal) : '';

      if (beforeStr !== afterStr) {
        diffList.push({
          key,
          before: beforeVal,
          after: afterVal
        });
      }
    }
    return diffList;
  };

  return (
    <div className="fixed inset-0 bg-black/55 flex items-center justify-center z-[100] p-3 sm:p-4 overflow-hidden animate-fadeIn">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden animate-scaleIn border border-gray-100">
        
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b bg-gradient-to-r from-gray-50 to-white">
          <div>
            <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
              <Clock size={20} className="text-blue-600" />
              Lịch sử thay đổi dữ liệu
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Bản ghi #{recordId} · Bảng {tableName === 'products' ? 'Sản phẩm' : tableName === 'customers' ? 'Khách hàng' : tableName}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-gray-100 transition">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {loading && (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-3">
              <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm">Đang tải dòng thời gian thay đổi...</p>
            </div>
          )}

          {error && (
            <div className="bg-red-50 text-red-700 p-4 rounded-xl text-center border border-red-100 text-sm">
              {error}
            </div>
          )}

          {!loading && !error && history.length === 0 && (
            <div className="text-center py-16 text-gray-400 space-y-2">
              <Clock size={40} className="mx-auto text-gray-300" />
              <p className="text-sm">Chưa có lịch sử thay đổi nào được ghi nhận.</p>
            </div>
          )}

          {!loading && !error && history.length > 0 && (
            <div className="relative border-l-2 border-gray-150 pl-5 ml-2.5 space-y-6">
              {history.map((entry) => {
                const diffs = getDiffs(entry.before, entry.after);
                
                return (
                  <div key={entry.id} className="relative group">
                    {/* Circle timeline indicator */}
                    <div className={`absolute -left-[31px] top-1.5 w-5 h-5 rounded-full border-4 border-white flex items-center justify-center shadow-sm ${
                      entry.is_conflict ? 'bg-red-500' : 'bg-blue-500'
                    }`} />

                    <div className={`card p-4 rounded-xl border transition hover:shadow-md ${
                      entry.is_conflict ? 'border-red-200 bg-red-50/20' : 'border-gray-200 bg-white'
                    }`}>
                      {/* Meta Info */}
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 pb-2 mb-3">
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                          <span className="flex items-center gap-1 font-medium text-gray-700">
                            <User size={13} className="text-gray-400" /> {entry.user_name}
                          </span>
                          <span>·</span>
                          <span>{formatTime(entry.timestamp)}</span>
                          {entry.is_conflict && (
                            <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-red-100 text-red-800 text-[10px] font-bold border border-red-200 animate-pulse">
                              <AlertTriangle size={10} /> Xung đột (Conflict)
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {getOpLabel(entry.op)}
                          {entry.op !== 'insert' && (
                            <button
                              onClick={() => handleRestore(entry.id)}
                              disabled={restoringId !== null}
                              className="px-2.5 py-1 text-xs font-semibold bg-gray-100 hover:bg-blue-50 text-gray-600 hover:text-blue-700 rounded border border-gray-200 hover:border-blue-200 flex items-center gap-1 transition disabled:opacity-50"
                              title="Khôi phục về trạng thái trước thay đổi này"
                            >
                              <RotateCcw size={12} className={restoringId === entry.id ? 'animate-spin' : ''} />
                              Khôi phục
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Diff Details */}
                      {entry.op === 'insert' && entry.after && (
                        <div className="text-xs text-gray-600">
                          <p className="font-semibold text-gray-800 mb-1">Dữ liệu khởi tạo:</p>
                          <div className="grid grid-cols-2 gap-2 bg-gray-50 p-2.5 rounded-lg border border-gray-100">
                            {Object.entries(entry.after)
                              .filter(([k]) => !['id', 'created_at', 'updated_at', 'active', 'parent_id'].includes(k))
                              .map(([k, v]) => (
                                <div key={k} className="flex justify-between border-b last:border-0 border-gray-200 py-1">
                                  <span className="text-gray-400 uppercase font-mono text-[10px]">{k}:</span>
                                  <span className="font-medium text-gray-800">{String(v ?? '')}</span>
                                </div>
                              ))}
                          </div>
                        </div>
                      )}

                      {entry.op === 'delete' && entry.before && (
                        <div className="text-xs text-red-600">
                          <p className="font-semibold mb-1">Dữ liệu bị xóa:</p>
                          <div className="bg-red-50/50 p-2.5 rounded-lg border border-red-100">
                            <span className="font-medium">{entry.before.name || entry.before.sku || `Bản ghi ID ${entry.before.id}`}</span>
                          </div>
                        </div>
                      )}

                      {entry.op === 'restore' && entry.after && (
                        <div className="text-xs text-purple-600">
                          <p className="font-semibold mb-1 flex items-center gap-1">
                            <CheckCircle size={12} /> Khôi phục về dữ liệu:
                          </p>
                          <div className="bg-purple-50/30 p-2.5 rounded-lg border border-purple-100 text-gray-700 font-medium">
                            {entry.after.name || entry.after.sku || `Trạng thái trước bản ghi ID ${entry.after.id}`}
                          </div>
                        </div>
                      )}

                      {entry.op === 'update' && diffs.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs font-semibold text-gray-700">Trường thay đổi:</p>
                          <div className="space-y-1.5">
                            {diffs.map((diff) => (
                              <div key={diff.key} className="grid grid-cols-1 sm:grid-cols-12 gap-1.5 text-xs bg-gray-50/50 p-2 rounded-lg border border-gray-150 items-center">
                                <div className="sm:col-span-3 font-mono font-bold text-gray-500 uppercase text-[10px] break-words">
                                  {diff.key}
                                </div>
                                <div className="sm:col-span-4 text-red-700 line-through bg-red-50 px-1.5 py-0.5 rounded border border-red-100 truncate" title={String(diff.before)}>
                                  {renderValue(diff.before)}
                                </div>
                                <div className="sm:col-span-1 text-center text-gray-400">
                                  <ArrowRight size={12} className="mx-auto" />
                                </div>
                                <div className="sm:col-span-4 text-green-700 font-medium bg-green-50 px-1.5 py-0.5 rounded border border-green-100 truncate" title={String(diff.after)}>
                                  {renderValue(diff.after)}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {entry.op === 'update' && diffs.length === 0 && (
                        <p className="text-xs text-gray-400 italic">Không phát hiện thay đổi trên các trường chính.</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
