import { useState, useEffect } from 'react';
import { API } from '../App';
import {
  Store, Settings2, Printer, Bot, Users,
  Plus, X, Edit2, Trash2, CheckCircle, Tag, HelpCircle
} from 'lucide-react';
import HelpModal from '../components/HelpModal';

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (!bytes) return 'Không rõ dung lượng';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function getUpdateStatusLabel(status) {
  const labels = {
    idle: 'Sẵn sàng',
    checking: 'Đang kiểm tra...',
    'no-update': 'Không có bản mới',
    'update-available': 'Có bản cập nhật',
    downloading: 'Đang tải cập nhật...',
    downloaded: 'Đã tải xong',
    installing: 'Đang cập nhật...',
    cancelled: 'Đã hủy tải',
    error: 'Có lỗi',
  };
  return labels[status] || 'Chưa kiểm tra';
}

function getUpdateErrorMessage(error) {
  if (!error) return '';
  const messages = {
    MANIFEST_URL_MISSING: 'Chưa xác định được URL cập nhật. Mặc định ứng dụng dùng GitHub Releases latest.yml.',
    CONFIG_INVALID: 'File cấu hình cập nhật không hợp lệ.',
    URL_INVALID: 'URL cập nhật hoặc installer không hợp lệ.',
    DEV_UPDATER_DISABLED: 'Auto-update bị tắt khi chạy development/unpacked. Hãy test trên bản đã cài bằng NSIS hoặc bật KHA_ENABLE_ELECTRON_UPDATER=1 có chủ đích.',
    WINDOW_NOT_READY: 'Chỉ kiểm tra cập nhật sau khi cửa sổ chính đã sẵn sàng.',
    ELECTRON_UPDATER_ERROR: 'electron-updater báo lỗi trong quá trình kiểm tra/tải cập nhật.',
    CHECK_FAILED: 'Kiểm tra cập nhật thất bại.',
    UPDATE_GITHUB_ATOM_FEED_NOT_AVAILABLE: 'Endpoint GitHub releases.atom không phù hợp hoặc không khả dụng. Bản mới sẽ đọc trực tiếp latest.yml public thay vì phụ thuộc Atom feed.',
    UPDATE_REPOSITORY_NOT_ACCESSIBLE: 'Không truy cập được GitHub Releases/latest. Repo có thể private, owner/repo sai, URL feed sai hoặc chưa có release latest public.',
    UPDATE_FEED_UNAUTHORIZED_OR_PRIVATE: 'GitHub Release/feed yêu cầu xác thực, token sai/thiếu quyền hoặc repo đang private. Client Electron không được nhúng token nên không thể tự cập nhật từ asset private.',
    UPDATE_FEED_METADATA_NOT_FOUND: 'Không tìm thấy latest.yml trong GitHub Release latest hoặc release latest không public.',
    UPDATE_ASSET_NOT_ACCESSIBLE_OR_PRIVATE: 'Không tải được installer/blockmap. Asset có thể thiếu, tên không khớp latest.yml hoặc repo private trả 404.',
    UPDATE_RELEASE_NOT_PUBLISHED: 'Chưa có production release đã publish để electron-updater chọn làm latest.',
    UPDATE_FEED_RATE_LIMITED: 'GitHub đang giới hạn truy cập feed cập nhật, vui lòng thử lại sau.',
    UPDATE_NETWORK_ERROR: 'Không kết nối được tới GitHub Releases. Vui lòng kiểm tra Internet, DNS, proxy/firewall.',
    NETWORK_ERROR: 'Không thể kết nối tới máy chủ cập nhật. Vui lòng kiểm tra mạng.',
    NETWORK_TIMEOUT: 'Kết nối tới máy chủ cập nhật quá thời gian chờ.',
    MANIFEST_HTTP_ERROR: 'Máy chủ không trả metadata cập nhật hợp lệ.',
    MANIFEST_INVALID_JSON: 'Metadata cập nhật không phải JSON/YAML hợp lệ.',
    MANIFEST_INVALID: 'Metadata cập nhật thiếu hoặc sai cấu trúc.',
    MANIFEST_INVALID_VERSION: 'Metadata thiếu version SemVer hợp lệ.',
    MANIFEST_INVALID_URL: 'Metadata thiếu URL gói cập nhật hợp lệ.',
    MANIFEST_INVALID_SHA256: 'Metadata thiếu checksum hợp lệ.',
    MANIFEST_INVALID_RELEASE_DATE: 'Metadata thiếu releaseDate.',
    UPDATE_NOT_AVAILABLE: 'Không có bản cập nhật mới để tải.',
    DOWNLOAD_IN_PROGRESS: 'Một lượt tải cập nhật đang chạy.',
    DOWNLOAD_HTTP_ERROR: 'Không tải được gói cập nhật từ máy chủ.',
    DOWNLOAD_FAILED: 'Tải gói cập nhật thất bại.',
    DOWNLOAD_CANCELLED: 'Người dùng đã hủy tải cập nhật.',
    CHECKSUM_MISMATCH: 'Checksum không khớp. Gói cập nhật đã bị xóa và sẽ không được chạy.',
    INSTALLER_NOT_DOWNLOADED: 'Chưa tải gói cập nhật.',
    UPDATE_NOT_DOWNLOADED: 'Chưa có bản cập nhật đã tải xong để cài đặt.',
    INSTALLER_NOT_FOUND: 'Không tìm thấy installer đã tải. Vui lòng tải lại.',
    INSTALL_IN_PROGRESS: 'Ứng dụng đang chuẩn bị cài đặt bản cập nhật.',
    SPAWN_INSTALLER_FAILED: 'Không thể chạy installer cập nhật.',
  };
  return messages[error.code] || error.message || 'Đã xảy ra lỗi cập nhật.';
}

function getManifestSourceLabel(updateState) {
  if (!updateState) return 'Chưa nạp cấu hình cập nhật';
  if (updateState.updateEngine === 'electron-updater') {
    if (updateState.feedProvider === 'generic') {
      return updateState.feedSource === 'package.build.publish.generic'
        ? 'GitHub Release latest.yml trực tiếp (package.json build.publish generic)'
        : 'GitHub Release latest.yml trực tiếp';
    }
    return updateState.feedSource === 'package.build.publish'
      ? 'GitHub Releases/electron-updater (package.json build.publish)'
      : 'GitHub Releases/electron-updater';
  }
  if (updateState.manifestUrlDefault) return 'GitHub Release mặc định';
  if (updateState.manifestUrlConfigured) return `Override nội bộ: ${updateState.manifestSource || 'env/config file'}`;
  return updateState.manifestSource || 'GitHub Release mặc định';
}

function formatUpdateErrorDetails(details) {
  if (!details) return '';
  if (typeof details === 'string') return details;
  try {
    return JSON.stringify(details, null, 2);
  } catch (_) {
    return String(details);
  }
}

export default function Settings({ store }) {
  const [tab, setTab] = useState('store');
  const [saved, setSaved] = useState(false);

  // Store form
  const [storeForm, setStoreForm] = useState({
    name: store?.name || '',
    email: store?.email || '',
    phone: store?.phone || '',
    tax_code: store?.tax_code || '',
    bank_account: store?.bank_account || '',
    bank_name: store?.bank_name || '',
    address: store?.address || '',
    invoice_width: store?.invoice_width || '80',
    invoice_logo: store?.invoice_logo || '',
    invoice_note: store?.invoice_note || '',
    invoice_slogan: store?.invoice_slogan || '',
    invoice_vietqr_logo: store?.invoice_vietqr_logo || '',
  });



  // Employee management
  const [employees, setEmployees] = useState([]);
  const [empForm, setEmpForm] = useState(null);
  const [showEmpModal, setShowEmpModal] = useState(false);
  const [empEdit, setEmpEdit] = useState(null);

  // Customer types
  const [customerTypes, setCustomerTypes] = useState([]);
  const [showTypeModal, setShowTypeModal] = useState(false);
  const [typeEdit, setTypeEdit] = useState(null);
  const [typeForm, setTypeForm] = useState({ name: '', color: '#3b82f6' });

  // Bot settings
  const [botForm, setBotForm] = useState({
    telegram_bot_token: '',
    telegram_chat_id: '',
    alert_low_stock: 5,
    alert_enabled: true,
  });

  // Help modal
  const [showHelp, setShowHelp] = useState(false);
  const [printTemplate, setPrintTemplate] = useState(() => localStorage.getItem('kha_print_template') || '3');

  // Desktop updater
  const [appInfo, setAppInfo] = useState(null);
  const [updateState, setUpdateState] = useState(null);
  const [updateBusy, setUpdateBusy] = useState('');
  const [updateResult, setUpdateResult] = useState(null);
  const [updateNotice, setUpdateNotice] = useState('');

  const handleSavePrintTemplate = (val) => {
    setPrintTemplate(val);
    localStorage.setItem('kha_print_template', val);
  };

  useEffect(() => {
    loadStore();
    loadBot();
    loadEmployees();
    loadCustomerTypes();
  }, []);

  useEffect(() => {
    if (!window.khaDesktop?.isElectron) return undefined;
    let mounted = true;
    const desktop = window.khaDesktop;

    desktop.getAppInfo?.().then(result => {
      if (!mounted || !result?.ok) return;
      setAppInfo(result.app || null);
      if (result.state) setUpdateState(result.state);
    }).catch(() => {});

    desktop.updates?.getState?.().then(result => {
      if (!mounted || !result?.ok) return;
      setUpdateState(result.state || null);
    }).catch(() => {});

    const unsubscribe = desktop.updates?.onStatus?.(payload => {
      setUpdateState(payload?.state || null);
      if (payload?.type === 'update-available') {
        const version = payload.updateInfo?.version || payload.state?.updateInfo?.version;
        setUpdateNotice(version ? `Có bản cập nhật ${version}.` : 'Có bản cập nhật mới.');
      }
      if (payload?.type === 'downloaded') setUpdateNotice('Đã tải và xác thực gói cập nhật. Chọn Cập nhật ngay hoặc Để sau.');
      if (payload?.type === 'install-deferred') setUpdateNotice('Đã chọn để sau. Ứng dụng tiếp tục chạy bình thường.');
      if (payload?.type === 'cancelled') setUpdateNotice('Đã hủy tải cập nhật.');
      if (payload?.type === 'error') setUpdateNotice(getUpdateErrorMessage(payload.error || payload.state?.lastError));
    });

    return () => {
      mounted = false;
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  const loadStore = async () => {
    const res = await fetch(`${API}/store`);
    const data = await res.json();
    setStoreForm(prev => ({ ...prev, ...data }));
  };

  const loadBot = async () => {
    const res = await fetch(`${API}/bot/settings`);
    const data = await res.json();
    setBotForm({
      telegram_bot_token: data.telegram_bot_token || '',
      telegram_chat_id: data.telegram_chat_id || '',
      alert_low_stock: data.alert_low_stock || 5,
      alert_enabled: data.alert_enabled !== false,
    });
  };

  const loadEmployees = async () => {
    const res = await fetch(`${API}/users`);
    const data = await res.json();
    setEmployees(Array.isArray(data) ? data : []);
  };

  const loadCustomerTypes = async () => {
    const res = await fetch(`${API}/customer-types`);
    const data = await res.json();
    setCustomerTypes(Array.isArray(data) ? data : []);
  };

  // ===== STORE =====
  const handleSaveStore = async () => {
    const res = await fetch(`${API}/store`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(storeForm),
    });
    const data = await res.json();
    if (data.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    }
  };

  // ===== BOT =====
  const handleSaveBot = async () => {
    const res = await fetch(`${API}/bot/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(botForm),
    });
    const data = await res.json();
    if (data.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    }
  };

  // ===== EMPLOYEES =====
  const handleDeleteEmp = async (id) => {
    if (!confirm('Xóa nhân viên này?')) return;
    await fetch(`${API}/users/${id}`, { method: 'DELETE' });
    loadEmployees();
  };

  const openAddEmp = () => {
    setEmpEdit(null);
    setEmpForm({ name: '', email: '', phone: '', password: '' });
    setShowEmpModal(true);
  };

  const openEditEmp = (e) => {
    setEmpEdit(e);
    setEmpForm({ name: e.name, email: e.email, phone: e.phone || '', password: '' });
    setShowEmpModal(true);
  };

  const handleSaveEmp = async () => {
    if (!empForm.name || !empForm.email || !empForm.phone) {
      alert('Vui lòng điền đầy đủ thông tin!'); return;
    }
    if (!empEdit && !empForm.password) {
      alert('Vui lòng nhập mật khẩu!'); return;
    }
    const payload = {
      name: empForm.name,
      email: empForm.email,
      phone: empForm.phone,
      ...(empForm.password ? { password: empForm.password } : {}),
    };
    if (empEdit) {
      await fetch(`${API}/users/${empEdit.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } else {
      await fetch(`${API}/users/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }
    setShowEmpModal(false);
    loadEmployees();
  };

  // ===== CUSTOMER TYPES =====
  const openAddType = () => {
    setTypeEdit(null);
    setTypeForm({ name: '', color: '#3b82f6' });
    setShowTypeModal(true);
  };

  const openEditType = (t) => {
    setTypeEdit(t);
    setTypeForm({ name: t.name, color: t.color || '#3b82f6' });
    setShowTypeModal(true);
  };

  const handleSaveType = async () => {
    if (!typeForm.name) { alert('Vui lòng nhập tên!'); return; }
    if (typeEdit) {
      await fetch(`${API}/customer-types/${typeEdit.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(typeForm),
      });
    } else {
      await fetch(`${API}/customer-types`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(typeForm),
      });
    }
    setShowTypeModal(false);
    loadCustomerTypes();
  };

  const handleDeleteType = async (id) => {
    if (!confirm('Xóa loại khách này?')) return;
    await fetch(`${API}/customer-types/${id}`, { method: 'DELETE' });
    loadCustomerTypes();
  };

  const runUpdateAction = async (busyKey, action) => {
    if (!window.khaDesktop?.updates) {
      setUpdateNotice('Tính năng cập nhật chỉ khả dụng trong ứng dụng Electron Windows.');
      return null;
    }

    setUpdateBusy(busyKey);
    setUpdateResult(null);
    try {
      const result = await action(window.khaDesktop.updates);
      setUpdateResult(result);
      if (result?.state) setUpdateState(result.state);
      if (!result?.ok) {
        setUpdateNotice(getUpdateErrorMessage(result?.error));
      } else if (busyKey === 'checking') {
        setUpdateNotice(result.updateAvailable ? `Có bản cập nhật ${result.updateInfo?.version}.` : 'Ứng dụng đang ở phiên bản mới nhất.');
      } else if (busyKey === 'downloading') {
        setUpdateNotice('Đã tải và xác thực gói cập nhật. Chọn Cập nhật ngay hoặc Để sau.');
      } else if (busyKey === 'installing') {
        setUpdateNotice('Đang cài đặt cập nhật. Ứng dụng sẽ restart theo electron-updater.');
      }
      return result;
    } catch (err) {
      const error = { code: err?.code || 'UNKNOWN_ERROR', message: err?.message || 'Đã xảy ra lỗi cập nhật.' };
      setUpdateResult({ ok: false, error });
      setUpdateNotice(getUpdateErrorMessage(error));
      return null;
    } finally {
      setUpdateBusy('');
    }
  };

  const handleCheckUpdate = () => runUpdateAction('checking', updates => updates.check({ manual: true }));
  const handleDownloadUpdate = () => runUpdateAction('downloading', updates => updates.download());
  const handleCancelUpdate = () => runUpdateAction('cancelling', updates => updates.cancel());
  const handleInstallUpdate = () => {
    if (!confirm('Ứng dụng sẽ tạo backup database rồi cài đặt/restart cập nhật. Tiếp tục?')) return null;
    return runUpdateAction('installing', updates => updates.install());
  };

  const desktopAvailable = Boolean(window.khaDesktop?.isElectron && window.khaDesktop?.updates);
  const currentVersion = appInfo?.version || updateState?.currentVersion || '1.1.10';
  const updateInfo = updateState?.updateInfo || null;
  const progress = updateState?.progress || null;
  const progressPercent = Math.max(0, Math.min(100, Number(progress?.percent) || 0));
  const hasUpdate = Boolean(updateState?.updateAvailable && updateInfo);
  const downloaded = Boolean(updateState?.status === 'downloaded' || updateState?.downloadedFile);
  const updateError = updateState?.lastError || (updateResult?.ok === false ? updateResult.error : null);
  const manifestUrl = updateState?.manifestUrl || updateState?.defaultManifestUrl || '';
  const manifestSourceLabel = getManifestSourceLabel(updateState);
  const updateLogPath = updateState?.updateLogPath || '';
  const runtimeDiagnostics = updateState?.runtimeDiagnostics || null;

  return (
    <div className="max-w-5xl">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-3 bg-blue-100 rounded-xl">
          <Settings2 className="text-blue-600" size={28} />
        </div>
        <div className="flex-1">
          <h1 className="text-xl font-bold">Cài đặt Hệ thống</h1>
          <p className="text-sm text-gray-500">Quản lý cửa hàng, nhân viên, khách hàng</p>
        </div>
        <button
          onClick={() => setShowHelp(true)}
          className="px-3 py-2 border border-gray-300 text-gray-600 hover:bg-gray-50 rounded-lg text-sm font-medium flex items-center gap-1"
        >
          <HelpCircle size={16} /> Hướng dẫn
        </button>
      </div>

      {/* Tab navigation */}
      <div className="flex flex-wrap gap-2 mb-6 bg-white rounded-xl p-2 shadow-sm border">
        {[
          { key: 'store', icon: <Store size={16} />, label: 'Cửa hàng' },
          { key: 'employees', icon: <Users size={16} />, label: 'Nhân viên' },
          { key: 'customer-types', icon: <Tag size={16} />, label: 'Loại khách' },
          { key: 'updates', icon: <Settings2 size={16} />, label: 'Cập nhật' },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${tab === t.key ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {/* ===== STORE TAB ===== */}
      {tab === 'store' && (
        <div className="card">
          <h2 className="font-bold mb-4 flex items-center gap-2"><Store size={18} /> Thông tin cửa hàng</h2>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="text-sm font-medium text-gray-700">Tên cửa hàng</label>
              <input className="input-field w-full mt-1" value={storeForm.name}
                onChange={e => setStoreForm({ ...storeForm, name: e.target.value })} />
            </div>
            <div><label className="text-sm font-medium text-gray-700">Số điện thoại</label>
              <input className="input-field w-full mt-1" value={storeForm.phone}
                onChange={e => setStoreForm({ ...storeForm, phone: e.target.value })} />
            </div>
            <div className="col-span-2"><label className="text-sm font-medium text-gray-700">Địa chỉ</label>
              <input className="input-field w-full mt-1" value={storeForm.address}
                onChange={e => setStoreForm({ ...storeForm, address: e.target.value })} />
            </div>
            <div><label className="text-sm font-medium text-gray-700">Email</label>
              <input className="input-field w-full mt-1" value={storeForm.email}
                onChange={e => setStoreForm({ ...storeForm, email: e.target.value })} />
            </div>
            <div><label className="text-sm font-medium text-gray-700">Mã số thuế (MST)</label>
              <input className="input-field w-full mt-1" value={storeForm.tax_code}
                onChange={e => setStoreForm({ ...storeForm, tax_code: e.target.value })} />
            </div>
            <div><label className="text-sm font-medium text-gray-700">Số tài khoản</label>
              <input className="input-field w-full mt-1" value={storeForm.bank_account}
                onChange={e => setStoreForm({ ...storeForm, bank_account: e.target.value })} />
            </div>
            <div><label className="text-sm font-medium text-gray-700">Tên ngân hàng</label>
              <input className="input-field w-full mt-1" value={storeForm.bank_name}
                onChange={e => setStoreForm({ ...storeForm, bank_name: e.target.value })} />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button onClick={handleSaveStore} className="btn-success flex items-center gap-1">
              <CheckCircle size={16} />💾 Lưu thay đổi
            </button>
            {saved && <span className="text-green-600 text-sm font-medium">✓ Đã lưu!</span>}
          </div>
        </div>
      )}

      {/* ===== INVOICE TAB ===== */}
      {tab === 'invoice' && (
        <div className="card">
          <h2 className="font-bold mb-4 flex items-center gap-2"><Printer size={18} /> Tùy chỉnh hóa đơn</h2>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="text-sm font-medium text-gray-700">Tên cửa hàng</label>
              <input className="input-field w-full mt-1" value={storeForm.name}
                onChange={e => setStoreForm({ ...storeForm, name: e.target.value })} />
            </div>
            <div><label className="text-sm font-medium text-gray-700">Số điện thoại</label>
              <input className="input-field w-full mt-1" value={storeForm.phone}
                onChange={e => setStoreForm({ ...storeForm, phone: e.target.value })} />
            </div>
            <div><label className="text-sm font-medium text-gray-700">Email</label>
              <input className="input-field w-full mt-1" value={storeForm.email}
                onChange={e => setStoreForm({ ...storeForm, email: e.target.value })} />
            </div>
            <div><label className="text-sm font-medium text-gray-700">Mã số thuế (MST)</label>
              <input className="input-field w-full mt-1" value={storeForm.tax_code}
                onChange={e => setStoreForm({ ...storeForm, tax_code: e.target.value })} />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Mẫu in hóa đơn</label>
              <select className="input-field w-full mt-1" value={printTemplate}
                onChange={e => handleSavePrintTemplate(e.target.value)}>
                <option value="1">Mẫu 1 — Logo nổi bật, thông tin 2 cột</option>
                <option value="2">Mẫu 2 — 2 box thông tin cửa hàng & đơn hàng</option>
                <option value="3">Mẫu 3 — Gọn, tiêu đề bên phải (kiểu Sapo)</option>
              </select>
              <div className="text-xs text-gray-400 mt-1">Áp dụng khi in từ Danh sách đơn hàng</div>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Kích thước hóa đơn</label>
              <select className="input-field w-full mt-1" value={storeForm.invoice_width}
                onChange={e => setStoreForm({ ...storeForm, invoice_width: e.target.value })}>
                <option value="58">58mm (Máy in mini)</option>
                <option value="76">76mm (Máy in trung)</option>
                <option value="80">80mm (Máy in phổ biến)</option>
                <option value="108">108mm (Máy in wide)</option>
              </select>
            </div>
            <div><label className="text-sm font-medium text-gray-700">Logo cửa hàng (URL)</label>
              <input className="input-field w-full mt-1" placeholder="https://.../logo.png"
                value={storeForm.invoice_logo}
                onChange={e => setStoreForm({ ...storeForm, invoice_logo: e.target.value })} />
              {storeForm.invoice_logo && <img src={storeForm.invoice_logo} alt="logo" className="mt-1 h-10 object-contain" onError={e => { e.target.style.display = 'none'; }} />}
            </div>
            <div><label className="text-sm font-medium text-gray-700">Logo VietQR (URL PNG)</label>
              <input className="input-field w-full mt-1" placeholder="https://.../vietqr-logo.png"
                value={storeForm.invoice_vietqr_logo}
                onChange={e => setStoreForm({ ...storeForm, invoice_vietqr_logo: e.target.value })} />
              <div className="text-xs text-gray-400 mt-1">Logo hiển thị bên dưới mã QR trên hóa đơn</div>
              {storeForm.invoice_vietqr_logo && <img src={storeForm.invoice_vietqr_logo} alt="vietqr logo" className="mt-1 h-10 object-contain" onError={e => { e.target.style.display = 'none'; }} />}
            </div>
            <div className="col-span-2"><label className="text-sm font-medium text-gray-700">Khẩu hiệu / Ghi chú</label>
              <input className="input-field w-full mt-1" placeholder="Cảm ơn quý khách! Hẹn gặp lại!"
                value={storeForm.invoice_slogan}
                onChange={e => setStoreForm({ ...storeForm, invoice_slogan: e.target.value })} />
            </div>
            <div className="col-span-2"><label className="text-sm font-medium text-gray-700">Ghi chú hóa đơn</label>
              <textarea className="input-field w-full mt-1" rows={3}
                placeholder="Nội dung ghi chú ở cuối hóa đơn..."
                value={storeForm.invoice_note}
                onChange={e => setStoreForm({ ...storeForm, invoice_note: e.target.value })} />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button onClick={handleSaveStore} className="btn-success flex items-center gap-1">
              <CheckCircle size={16} />💾 Lưu cài đặt in
            </button>
            {saved && <span className="text-green-600 text-sm font-medium">✓ Đã lưu!</span>}
          </div>
        </div>
      )}

      

      {/* ===== EMPLOYEES TAB ===== */}
      {tab === 'employees' && (
        <div>
          {/* Danh sách nhân viên */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold flex items-center gap-2"><Users size={18} /> Nhân viên ({employees.length})</h3>
              <button onClick={openAddEmp} className="btn-primary flex items-center gap-1 text-sm">
                <Plus size={14} /> Thêm nhân viên
              </button>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-100 text-gray-600 text-xs">
                  <th className="p-2 text-left">Họ tên</th>
                  <th className="p-2 text-left">Email</th>
                  <th className="p-2 text-left">SĐT</th>
                  <th className="p-2 text-left">Vai trò</th>
                  <th className="p-2 text-center">Hành động</th>
                </tr>
              </thead>
              <tbody>
                {employees.map(u => (
                  <tr key={u.id} className="border-b hover:bg-gray-50">
                    <td className="p-2 font-medium">{u.name}</td>
                    <td className="p-2 text-gray-600">{u.email}</td>
                    <td className="p-2">{u.phone || '—'}</td>
                    <td className="p-2">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${u.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                        {u.role === 'admin' ? 'Admin' : 'Nhân viên'}
                      </span>
                    </td>
                    <td className="p-2 text-center flex justify-center gap-1">
                      <button onClick={() => openEditEmp(u)} className="text-blue-600 hover:text-blue-800 text-xs px-2 py-1 border border-blue-300 rounded flex items-center gap-1">
                        <Edit2 size={12} /> Sửa
                      </button>
                      {u.role !== 'admin' && (
                        <button onClick={() => handleDeleteEmp(u.id)} className="text-red-500 hover:text-red-700 text-xs px-2 py-1 border border-red-300 rounded flex items-center gap-1">
                          <Trash2 size={12} /> Xóa
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===== CUSTOMER TYPES TAB ===== */}
      {tab === 'customer-types' && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold flex items-center gap-2"><Tag size={18} /> Loại khách hàng ({customerTypes.length})</h3>
            <button onClick={openAddType} className="btn-primary flex items-center gap-1 text-sm">
              <Plus size={14} /> Thêm loại khách
            </button>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {customerTypes.map(t => (
              <div key={t.id} className="border rounded-xl p-4 flex items-center justify-between"
                style={{ borderLeftColor: t.color, borderLeftWidth: 4 }}>
                <div>
                  <div className="font-semibold text-sm">{t.name}</div>
                  <div className="text-xs text-gray-400">#{t.id}</div>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => openEditType(t)} className="text-blue-600 hover:text-blue-800 p-1">
                    <Edit2 size={14} />
                  </button>
                  <button onClick={() => handleDeleteType(t.id)} className="text-red-500 hover:text-red-700 p-1">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ===== UPDATES TAB ===== */}
      {tab === 'updates' && (
        <div className="space-y-4">
          <div className="card">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h2 className="font-bold flex items-center gap-2"><Settings2 size={18} /> Cập nhật ứng dụng</h2>
                <p className="text-sm text-gray-500 mt-1">Nếu feed GitHub Release truy cập công khai được, ứng dụng tự kiểm tra, tự tải gói cập nhật và chỉ cài/restart khi người dùng chọn “Cập nhật ngay”.</p>
              </div>
              <span className={`px-3 py-1 rounded-full text-xs font-semibold ${updateState?.status === 'error' ? 'bg-red-100 text-red-700' : hasUpdate ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>
                {getUpdateStatusLabel(updateState?.status)}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div className="border rounded-xl p-4 bg-gray-50">
                <div className="text-gray-500">Phiên bản hiện tại</div>
                <div className="text-2xl font-bold text-gray-800 mt-1">{currentVersion}</div>
                <div className="text-xs text-gray-500 mt-2">Nền tảng: {appInfo?.platform || window.khaDesktop?.platform || 'offline'} · Kiến trúc: {appInfo?.arch || 'unknown'}</div>
              </div>
              <div className="border rounded-xl p-4 bg-gray-50">
                <div className="text-gray-500">Feed cập nhật</div>
                <div className="font-medium text-gray-800 break-all mt-1">{manifestUrl || 'Chưa nạp URL feed'}</div>
                <div className="text-xs text-gray-500 mt-2">Nguồn: {manifestSourceLabel}</div>
                {updateState?.manifestUrlDefault && (
                  <div className="mt-2 inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
                    Đang dùng GitHub Release feed mặc định
                  </div>
                )}
              </div>
            </div>

            {updateLogPath && (
              <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-600">
                <div className="font-semibold text-gray-700">Log cập nhật</div>
                <div className="break-all mt-1">{updateLogPath}</div>
                <div className="mt-1">File này ghi các bước check/download/dialog/backup/quitAndInstall và lỗi mạng để debug, không chứa token hay mật khẩu.</div>
              </div>
            )}

            {runtimeDiagnostics && (
              <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-600">
                <div className="font-semibold text-gray-700">Chẩn đoán runtime updater</div>
                <div className="mt-1 grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1">
                  <div>Đã đóng gói: {runtimeDiagnostics.isPackaged ? 'Có' : 'Không'}</div>
                  <div>app-update.yml: {runtimeDiagnostics.appUpdateYmlExists ? 'Có' : 'Không thấy'}</div>
                  <div className="break-all md:col-span-2">Đường dẫn app-update.yml: {runtimeDiagnostics.appUpdateYmlPath || 'Không xác định'}</div>
                </div>
              </div>
            )}

            {!desktopAvailable && (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                Tính năng cập nhật chỉ hoạt động trong ứng dụng Electron đã cài trên Windows. Khi chạy frontend web độc lập, API cập nhật sẽ không khả dụng.
              </div>
            )}

            {updateNotice && (
              <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">{updateNotice}</div>
            )}

            {updateError && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                <div className="font-semibold">Không thể hoàn tất thao tác cập nhật</div>
                <div>{getUpdateErrorMessage(updateError)}</div>
                {updateError.details && <pre className="mt-2 whitespace-pre-wrap text-xs bg-white/70 rounded p-2">{formatUpdateErrorDetails(updateError.details)}</pre>}
              </div>
            )}

            {hasUpdate && (
              <div className="mt-4 border rounded-xl p-4 bg-white">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-sm text-gray-500">Bản mới</div>
                    <div className="text-xl font-bold text-green-700">{updateInfo.version}</div>
                  </div>
                  <div className="text-right text-xs text-gray-500">
                    <div>Ngày phát hành: {updateInfo.releaseDate || 'Không rõ'}</div>
                    <div>Dung lượng: {formatBytes(updateInfo.size)}</div>
                    {updateInfo.mandatory && <div className="text-red-600 font-semibold">Bản cập nhật bắt buộc</div>}
                  </div>
                </div>
                <div className="mt-3 text-sm">
                  <div className="font-semibold text-gray-700 mb-1">Ghi chú phát hành</div>
                  <pre className="whitespace-pre-wrap bg-gray-50 border rounded-lg p-3 text-gray-700 text-sm">{updateInfo.releaseNotes || 'Không có ghi chú phát hành.'}</pre>
                </div>
                <div className="mt-3 text-xs text-gray-500 break-all">
                  <div>Installer/feed path: {updateInfo.url || updateInfo.path || 'Theo latest.yml'}</div>
                  {updateInfo.sha512 ? <div>SHA512: {updateInfo.sha512}</div> : updateInfo.sha256 ? <div>SHA256: {updateInfo.sha256}</div> : null}
                </div>
              </div>
            )}

            {updateState?.status === 'no-update' && updateState?.lastCheckedAt && (
              <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
                Ứng dụng đang ở phiên bản mới nhất. Lần kiểm tra: {new Date(updateState.lastCheckedAt).toLocaleString('vi-VN')}.
              </div>
            )}

            {updateState?.status === 'downloading' && (
              <div className="mt-4">
                <div className="flex items-center justify-between text-sm mb-1">
                  <span>Tiến trình tải</span>
                  <span>{progressPercent}%</span>
                </div>
                <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-600 transition-all" style={{ width: `${progressPercent}%` }} />
                </div>
                <div className="text-xs text-gray-500 mt-1">{formatBytes(progress?.transferred)} / {formatBytes(progress?.total)}</div>
              </div>
            )}

            {downloaded && (
              <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
                electron-updater đã tải và xác thực gói cập nhật thành công. Khi bấm Cập nhật ngay, ứng dụng sẽ backup database trước rồi cài đặt/restart.
              </div>
            )}

            <div className="mt-5 flex flex-wrap gap-2">
              <button onClick={handleCheckUpdate} disabled={!desktopAvailable || updateBusy === 'checking' || updateState?.status === 'downloading'} className="btn-primary disabled:opacity-60">
                {updateBusy === 'checking' ? 'Đang kiểm tra...' : 'Kiểm tra cập nhật'}
              </button>
              <button onClick={handleDownloadUpdate} disabled={!desktopAvailable || !hasUpdate || downloaded || updateState?.status === 'downloading'} className="btn-success disabled:opacity-60">
                {updateBusy === 'downloading' ? 'Đang tải...' : 'Tải bản cập nhật'}
              </button>
              {updateState?.status === 'downloading' && (
                <button onClick={handleCancelUpdate} disabled={updateBusy === 'cancelling'} className="btn-danger disabled:opacity-60">Hủy tải</button>
              )}
              <button onClick={handleInstallUpdate} disabled={!desktopAvailable || !downloaded || updateBusy === 'installing'} className="btn-danger disabled:opacity-60">
                {updateBusy === 'installing' ? 'Đang cập nhật...' : 'Cập nhật ngay'}
              </button>
            </div>
          </div>

          <div className="card bg-blue-50 border-blue-100 text-sm text-blue-800">
            <h3 className="font-bold mb-2">Cấu hình update feed</h3>
            <ul className="list-disc pl-5 space-y-1">
              <li>Mặc định app cấu hình electron-updater provider generic để đọc trực tiếp latest.yml: {updateState?.defaultManifestUrl || 'https://github.com/Vankhadev/phanmemoffline/releases/latest/download/latest.yml'}.</li>
              <li>Cách này tránh phụ thuộc endpoint releases.atom của GitHub; latest.yml vẫn phải là asset public trong GitHub Release latest.</li>
              <li>Khi feed và asset public, khách hàng không cần tự tải installer; app tự kiểm tra/tải gói cập nhật và chỉ cài đặt sau khi người dùng bấm “Cập nhật ngay”.</li>
              <li>Bản development/unpacked không auto-update trừ khi bật KHA_ENABLE_ELECTRON_UPDATER=1 có chủ đích để test.</li>
              <li>GitHub Release production cần có installer .exe, .exe.blockmap và latest.yml do electron-builder tạo.</li>
              <li>Nếu repo GitHub hoặc release asset đang private, client không có token sẽ nhận 401/403/404 và không thể hiện dialog cập nhật; khi đó cần chuyển feed public hoặc người dùng phải tải/cài installer thủ công từ nguồn được cấp quyền.</li>
              <li>Trước khi cài đặt, ứng dụng backup phanmienoffline.db.json trong userData/backups và không xóa userData.</li>
            </ul>
          </div>
        </div>
      )}

      {/* ===== MODALS ===== */}
      {/* Employee modal */}
      {showEmpModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-[480px]">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">{empEdit ? 'Sửa nhân viên' : 'Thêm nhân viên'}</h2>
              <button onClick={() => setShowEmpModal(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <div className="space-y-3 mb-4">
              <div><label className="text-xs text-gray-500">Họ tên</label>
                <input className="input-field w-full" value={empForm.name}
                  onChange={e => setEmpForm({ ...empForm, name: e.target.value })} />
              </div>
              <div><label className="text-xs text-gray-500">Email</label>
                <input className="input-field w-full" type="email" value={empForm.email}
                  onChange={e => setEmpForm({ ...empForm, email: e.target.value })} />
              </div>
              <div><label className="text-xs text-gray-500">SĐT</label>
                <input className="input-field w-full" value={empForm.phone}
                  onChange={e => setEmpForm({ ...empForm, phone: e.target.value })} />
              </div>
              <div><label className="text-xs text-gray-500">Mật khẩu {empEdit && '(để trống nếu không đổi)'}</label>
                <input className="input-field w-full" type="password" value={empForm.password}
                  onChange={e => setEmpForm({ ...empForm, password: e.target.value })} />
              </div>
              <div className="bg-blue-50 border border-blue-200 text-blue-700 rounded-lg px-3 py-2 text-xs">
                Server tự động gán quyền: tài khoản đầu tiên là ADMIN, các tài khoản sau là USER. Client không được chọn hoặc gửi role.
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={handleSaveEmp} className="btn-success flex-1">💾 Lưu</button>
              <button onClick={() => setShowEmpModal(false)} className="btn-danger flex-1">Hủy</button>
            </div>
          </div>
        </div>
      )}

      {/* Customer type modal */}
      {showTypeModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-[400px]">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">{typeEdit ? 'Sửa loại khách' : 'Thêm loại khách'}</h2>
              <button onClick={() => setShowTypeModal(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <div className="space-y-3 mb-4">
              <div><label className="text-xs text-gray-500">Tên loại khách</label>
                <input className="input-field w-full" value={typeForm.name}
                  onChange={e => setTypeForm({ ...typeForm, name: e.target.value })} placeholder="VD: Khách VIP" />
              </div>
              <div><label className="text-xs text-gray-500">Màu sắc</label>
                <div className="flex gap-2 items-center mt-1">
                  <input type="color" className="w-10 h-10 rounded cursor-pointer border"
                    value={typeForm.color}
                    onChange={e => setTypeForm({ ...typeForm, color: e.target.value })} />
                  <span className="text-sm text-gray-500">{typeForm.color}</span>
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={handleSaveType} className="btn-success flex-1">💾 Lưu</button>
              <button onClick={() => setShowTypeModal(false)} className="btn-danger flex-1">Hủy</button>
            </div>
          </div>
        </div>
      )}

      {/* Help Modal */}
      {showHelp && (
        <HelpModal
          title="Hướng dẫn sử dụng Cài đặt Hệ thống"
          onClose={() => setShowHelp(false)}
          content={
            <div className="space-y-4 text-sm text-gray-700">
              <div>
                <h3 className="font-bold text-gray-800 mb-2">⚙️ Tổng quan</h3>
                <p>Trang Cài đặt giúp bạn cấu hình toàn bộ hệ thống: thông tin cửa hàng, thiết lập hóa đơn, quản lý nhân viên, loại khách hàng và Telegram Bot thông báo.</p>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">🏪 Tab Cửa hàng</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li><strong>Tên cửa hàng:</strong> Hiển thị trên hóa đơn và trang chủ</li>
                  <li><strong>SĐT, Email:</strong> Thông tin liên hệ</li>
                  <li><strong>MST:</strong> Mã số thuế xuất hóa đơn</li>
                  <li><strong>Ngân hàng:</strong> Tên ngân hàng và số tài khoản (dùng cho QR code)</li>
                  <li><strong>Địa chỉ:</strong> Địa chỉ cửa hàng</li>
                  <li><strong>Chiều rộng hóa đơn:</strong> Độ rộng khi in (mm)</li>
                  <li><strong>Logo hóa đơn:</strong> URL hình logo (có thể để trống)</li>
                  <li><strong>Ghi chú hóa đơn:</strong> Hiển thị dưới mỗi hóa đơn</li>
                  <li><strong>Slogan hóa đơn:</strong> Dòng chữ cuối hóa đơn (VD: "Cảm ơn quý khách!")</li>
                </ul>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">🖨️ Tab Hóa đơn</h3>
                <p>Tính năng này đang được phát triển. Mục tiêu: cấu hình mẫu hóa đơn, font chữ, header/footer.</p>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">👥 Tab Nhân viên</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li><strong>Danh sách nhân viên:</strong> Hiển thị tất cả user đang hoạt động</li>
                  <li><strong>Thêm nhân viên:</strong> Server tự động gán ADMIN cho tài khoản đầu tiên, các tài khoản sau là USER</li>
                  <li><strong>Chỉnh sửa:</strong> Đổi tên, email, SĐT, mật khẩu; client không được chọn role</li>
                  <li><strong>Xóa:</strong> Xóa nhân viên (không xóa được admin đang đăng nhập)</li>
                  <li>Mật khẩu mặc định: 123456 (nhân viên tự đổi được ở trang cá nhân)</li>
                </ul>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">🏷️ Tab Loại khách</h3>
                <p>Quản lý phân loại khách hàng:</p>
                <ul className="list-disc pl-5 mt-2 space-y-1">
                  <li><strong>Thêm loại:</strong> Tạo loại mới (VD: VIP, Sỉ, Lẻ) với chọn màu</li>
                  <li><strong>Sửa loại:</strong> Đổi tên/màu</li>
                  <li><strong>Xóa loại:</strong> Chỉ xóa được nếu không có khách thuộc loại này</li>
                  <li>Màu loại sẽ hiển thị khi chọn khách hàng trong POS</li>
                </ul>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">🤖 Telegram Bot</h3>
                <p>Cài đặt bot Telegram để nhận thông báo:</p>
                <ul className="list-disc pl-5 mt-2 space-y-1">
                  <li><strong>Bot Token:</strong> Lấy từ @BotFather (Bot API Token)</li>
                  <li><strong>Chat ID:</strong> ID của chat/nhóm để bot gửi thông báo</li>
                  <li><strong>Cảnh báo tồn kho:</strong> Ngưỡng tồn kho thấp để nhận thông báo</li>
                  <li><strong>Bật thông báo:</strong> Tắt/bật bot</li>
                </ul>
                <p className="mt-2">Bot sẽ gửi thông báo khi: hàng sắp hết tồn kho, có đơn hàng mới...</p>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">🔄 Tab Cập nhật</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Mặc định kiểm tra GitHub Releases latest.yml bằng electron-updater.</li>
                  <li>Tải gói cập nhật về cache người dùng và chỉ cài đặt khi người dùng chọn “Cập nhật ngay”.</li>
                  <li>Hiển thị đường dẫn update.log để debug trạng thái check, tải, dialog, backup, quitAndInstall và lỗi mạng.</li>
                  <li>Backup database userData trước khi cài đặt cập nhật, không xóa dữ liệu cục bộ.</li>
                </ul>
              </div>

              <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                <h3 className="font-bold text-blue-800 mb-2">💡 Lưu ý quan trọng</h3>
                <ul className="list-disc pl-5 space-y-1 text-blue-700">
                  <li><strong>Lưu cài đặt:</strong> Nhấn "Lưu thay đổi" ở mỗi tab sau khi chỉnh sửa</li>
                  <li><strong>Xác thực:</strong> Chỉ admin mới có quyền truy cập trang Cài đặt</li>
                  <li><strong>Telegram Bot:</strong> Cần tạo bot trước qua @BotFather và lấy token</li>
                  <li>Thay đổi thông tin cửa hàng sẽ ảnh hưởng đến hóa đơn in</li>
                </ul>
              </div>
            </div>
          }
        />
      )}
    </div>
  );
}
