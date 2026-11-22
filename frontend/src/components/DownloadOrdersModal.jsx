import React, { useState, useEffect } from 'react';
import {
  FolderDown,
  Download,
  FolderArchive,
  Folder,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  Loader2,
  X,
  HardDrive,
  Users,
  Receipt,
  FileCheck,
} from 'lucide-react';
import JSZip from 'jszip';
import { apiJson, apiFetch, getApiBase } from '../utils/apiClient';

export default function DownloadOrdersModal({
  isOpen,
  onClose,
  selectedOrderIds = [],
}) {
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [summary, setSummary] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [scope, setScope] = useState('all'); // 'all' | 'selected'

  const hasSelection = selectedOrderIds && selectedOrderIds.length > 0;
  const isDirectoryPickerSupported = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

  useEffect(() => {
    if (!isOpen) {
      setSuccessMessage('');
      setErrorMessage('');
      setStatusText('');
      return;
    }

    const currentScope = hasSelection ? 'selected' : 'all';
    setScope(currentScope);
    loadSummary(currentScope);
  }, [isOpen]);

  const loadSummary = async (targetScope) => {
    setLoadingSummary(true);
    setErrorMessage('');
    try {
      const query = new URLSearchParams();
      query.set('scope', targetScope);
      if (targetScope === 'selected' && selectedOrderIds.length > 0) {
        query.set('ids', selectedOrderIds.join(','));
      }

      const res = await apiJson(`/invoices/download-by-customer/summary?${query.toString()}`);
      if (res && res.ok) {
        setSummary(res);
      } else {
        setErrorMessage(res?.error || 'Không thể lấy thông tin đơn hàng.');
      }
    } catch (err) {
      setErrorMessage(err.message || 'Lỗi khi tải thông tin.');
    } finally {
      setLoadingSummary(false);
    }
  };

  const handleScopeChange = (newScope) => {
    setScope(newScope);
    loadSummary(newScope);
  };

  // Tải file ZIP trọn gói về máy
  const handleDownloadZip = async () => {
    setDownloading(true);
    setErrorMessage('');
    setSuccessMessage('');
    setStatusText('Đang tạo các tệp tin Excel theo từng khách hàng...');

    try {
      const query = new URLSearchParams();
      query.set('scope', scope);
      if (scope === 'selected' && selectedOrderIds.length > 0) {
        query.set('ids', selectedOrderIds.join(','));
      }

      const res = await apiFetch(`/invoices/download-by-customer?${query.toString()}`);
      if (!res.ok) {
        const errorJson = await res.json().catch(() => ({}));
        throw new Error(errorJson.error || `HTTP ${res.status}`);
      }

      const blob = await res.blob();
      const disposition = res.headers.get('content-disposition') || '';
      let fileName = 'Don_Hang_Theo_Khach_Hang.zip';
      const match = disposition.match(/filename\*?=(?:UTF-8'')?([^;]+)/i);
      if (match && match[1]) {
        fileName = decodeURIComponent(match[1].replace(/["']/g, ''));
      }

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      setSuccessMessage(`Đã tải thành công file ZIP chứa ${summary?.customerCount || 0} tệp tin khách hàng về máy!`);
    } catch (err) {
      setErrorMessage(err.message || 'Lỗi khi tải đơn hàng.');
    } finally {
      setDownloading(false);
      setStatusText('');
    }
  };

  // Chọn thư mục trên ổ đĩa và lưu trực tiếp từng file khách hàng vào đó
  const handleSaveToDirectory = async () => {
    if (!isDirectoryPickerSupported) {
      handleDownloadZip();
      return;
    }

    setErrorMessage('');
    setSuccessMessage('');

    let dirHandle;
    try {
      dirHandle = await window.showDirectoryPicker({
        mode: 'readwrite',
        startIn: 'downloads',
      });
    } catch (err) {
      if (err.name === 'AbortError') return; // Người dùng bấm Hủy
      setErrorMessage('Không thể mở cửa sổ chọn thư mục: ' + err.message);
      return;
    }

    setDownloading(true);
    setStatusText('Đang tạo và lưu từng tệp tin khách hàng vào ổ đĩa...');

    try {
      const query = new URLSearchParams();
      query.set('scope', scope);
      if (scope === 'selected' && selectedOrderIds.length > 0) {
        query.set('ids', selectedOrderIds.join(','));
      }

      const res = await apiFetch(`/invoices/download-by-customer?${query.toString()}`);
      if (!res.ok) {
        const errorJson = await res.json().catch(() => ({}));
        throw new Error(errorJson.error || `HTTP ${res.status}`);
      }

      const blob = await res.blob();
      const zip = await JSZip.loadAsync(blob);

      let savedFilesCount = 0;
      const fileNames = Object.keys(zip.files).filter(name => !zip.files[name].dir);

      for (const fileName of fileNames) {
        setStatusText(`Đang lưu: ${fileName} (${savedFilesCount + 1}/${fileNames.length})...`);
        const fileData = await zip.files[fileName].async('arraybuffer');
        const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(fileData);
        await writable.close();
        savedFilesCount += 1;
      }

      setSuccessMessage(
        `✅ Đã lưu trực tiếp thành công ${savedFilesCount} tệp tin khách hàng vào thư mục trên ổ đĩa "${dirHandle.name}"!`
      );
    } catch (err) {
      setErrorMessage('Lỗi khi lưu vào thư mục ổ đĩa: ' + err.message);
    } finally {
      setDownloading(false);
      setStatusText('');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="relative w-full max-w-2xl rounded-3xl bg-white shadow-2xl border border-gray-100 overflow-hidden flex flex-col max-h-[90vh]">
        {/* HEADER */}
        <div className="bg-gradient-to-r from-indigo-700 via-indigo-600 to-purple-700 px-6 py-5 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15 backdrop-blur-xs">
              <FolderDown size={24} className="text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold">Tải Đơn Hàng Về Ổ Đĩa</h2>
              <p className="text-xs text-indigo-100">
                Tự động tách riêng từng tệp tin Excel (.xlsx) theo từng khách hàng
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* BODY */}
        <div className="p-6 space-y-5 overflow-y-auto flex-1 text-sm text-gray-700">
          {/* PHẠM VI TẢI (ALL / SELECTED) */}
          {hasSelection && (
            <div className="flex items-center gap-3 rounded-2xl bg-indigo-50/70 p-3 border border-indigo-100">
              <span className="font-semibold text-xs text-indigo-900">Phạm vi tải:</span>
              <div className="inline-flex rounded-xl bg-white p-1 shadow-xs border border-indigo-200">
                <button
                  type="button"
                  onClick={() => handleScopeChange('all')}
                  className={`px-3 py-1 text-xs font-semibold rounded-lg transition ${scope === 'all' ? 'bg-indigo-600 text-white shadow-xs' : 'text-gray-600 hover:text-gray-900'}`}
                >
                  Tất cả đơn hàng ({summary?.invoiceCount || '...'})
                </button>
                <button
                  type="button"
                  onClick={() => handleScopeChange('selected')}
                  className={`px-3 py-1 text-xs font-semibold rounded-lg transition ${scope === 'selected' ? 'bg-indigo-600 text-white shadow-xs' : 'text-gray-600 hover:text-gray-900'}`}
                >
                  Chỉ {selectedOrderIds.length} đơn đã chọn
                </button>
              </div>
            </div>
          )}

          {/* THỐNG KÊ TỔNG QUAN */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-2xl border border-blue-100 bg-blue-50/50 p-4">
              <div className="flex items-center gap-2 text-blue-700 text-xs font-semibold">
                <Receipt size={16} />
                <span>Tổng số đơn hàng</span>
              </div>
              <div className="mt-2 text-2xl font-bold text-gray-800">
                {loadingSummary ? '...' : (summary?.invoiceCount || 0).toLocaleString('vi-VN')}
              </div>
              <p className="text-[11px] text-gray-500 mt-0.5">Hóa đơn cần xuất</p>
            </div>

            <div className="rounded-2xl border border-purple-100 bg-purple-50/50 p-4">
              <div className="flex items-center gap-2 text-purple-700 text-xs font-semibold">
                <Users size={16} />
                <span>Số khách hàng</span>
              </div>
              <div className="mt-2 text-2xl font-bold text-purple-700">
                {loadingSummary ? '...' : (summary?.customerCount || 0).toLocaleString('vi-VN')}
              </div>
              <p className="text-[11px] text-gray-500 mt-0.5">Khách hàng có đơn</p>
            </div>

            <div className="rounded-2xl border border-emerald-100 bg-emerald-50/50 p-4">
              <div className="flex items-center gap-2 text-emerald-700 text-xs font-semibold">
                <FileCheck size={16} />
                <span>Số tệp tin tạo ra</span>
              </div>
              <div className="mt-2 text-2xl font-bold text-emerald-700">
                {loadingSummary ? '...' : `${summary?.customerCount || 0} tệp`}
              </div>
              <p className="text-[11px] text-gray-500 mt-0.5">1 tệp / 1 khách hàng</p>
            </div>
          </div>

          {/* DANH SÁCH TỆP TIN SẼ ĐƯỢC TẠO */}
          <div className="rounded-2xl border border-gray-200 bg-gray-50/50 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-xs uppercase tracking-wider text-gray-600 flex items-center gap-1.5">
                <FileSpreadsheet size={15} className="text-emerald-600" />
                Danh sách tệp tin theo khách hàng (Xem trước)
              </span>
              <span className="text-xs text-gray-500">
                {summary?.customers?.length || 0} tệp tin
              </span>
            </div>

            {loadingSummary ? (
              <div className="flex items-center justify-center py-6 text-gray-400 gap-2">
                <Loader2 size={18} className="animate-spin text-indigo-600" />
                <span>Đang phân loại đơn hàng theo khách hàng...</span>
              </div>
            ) : summary?.customers && summary.customers.length > 0 ? (
              <div className="max-h-44 overflow-y-auto space-y-1.5 pr-1 divide-y divide-gray-100">
                {summary.customers.map((cust, idx) => (
                  <div key={idx} className="flex items-center justify-between pt-1.5 first:pt-0 text-xs">
                    <div className="flex items-center gap-2 truncate">
                      <span className="font-mono text-gray-400 w-5">{idx + 1}.</span>
                      <span className="font-semibold text-gray-800 truncate" title={cust.fileName}>
                        📄 {cust.fileName}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="rounded-full bg-indigo-100 px-2 py-0.5 font-bold text-indigo-700 text-[11px]">
                        {cust.invoiceCount} hóa đơn
                      </span>
                      <span className="text-gray-500 font-mono text-[11px]">
                        {cust.totalAmount.toLocaleString('vi-VN')} đ
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-4 text-xs text-gray-400 italic">
                Không tìm thấy đơn hàng nào để xuất.
              </div>
            )}
          </div>

          {/* TRẠNG THÁI & THÔNG BÁO */}
          {statusText && (
            <div className="flex items-center gap-2 rounded-xl bg-indigo-50 border border-indigo-200 p-3 text-xs text-indigo-800">
              <Loader2 size={16} className="animate-spin text-indigo-600 shrink-0" />
              <span className="font-medium">{statusText}</span>
            </div>
          )}

          {successMessage && (
            <div className="flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-800">
              <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />
              <span className="font-medium">{successMessage}</span>
            </div>
          )}

          {errorMessage && (
            <div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-200 p-3 text-xs text-red-800">
              <AlertCircle size={18} className="text-red-600 shrink-0" />
              <span className="font-medium">{errorMessage}</span>
            </div>
          )}
        </div>

        {/* FOOTER ACTIONS */}
        <div className="border-t border-gray-100 bg-gray-50/80 px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="text-xs text-gray-500 flex items-center gap-1.5">
            <HardDrive size={14} className="text-indigo-600" />
            <span>Mỗi khách hàng 1 file riêng biệt, tự động đặt tên theo khách.</span>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={downloading}
              className="px-4 py-2 rounded-xl border border-gray-300 bg-white hover:bg-gray-50 text-xs font-semibold text-gray-700 transition"
            >
              Đóng
            </button>

            {/* CÁCH 1: LƯU THẲNG VÀO THƯ MỤC TRÊN Ổ ĐĨA */}
            {isDirectoryPickerSupported && (
              <button
                type="button"
                onClick={handleSaveToDirectory}
                disabled={downloading || !summary?.invoiceCount}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-2 shadow-sm transition"
                title="Mở hộp thoại chọn thư mục trên ổ đĩa máy tính và lưu thẳng từng tệp tin khách hàng vào đó"
              >
                {downloading ? <Loader2 size={14} className="animate-spin" /> : <Folder size={14} />}
                Chọn thư mục ổ đĩa lưu
              </button>
            )}

            {/* CÁCH 2: TẢI TRỌN GÓI ZIP */}
            <button
              type="button"
              onClick={handleDownloadZip}
              disabled={downloading || !summary?.invoiceCount}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-2 shadow-sm transition"
              title="Tải về file .ZIP chứa toàn bộ các tệp tin theo từng khách hàng"
            >
              {downloading ? <Loader2 size={14} className="animate-spin" /> : <FolderArchive size={14} />}
              Tải trọn gói file ZIP
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
