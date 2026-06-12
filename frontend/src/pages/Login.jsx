import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  authApi,
  clearLocalApiBaseOverride,
  getApiBase,
  getApiErrorMessage,
  getLocalApiBaseOverride,
  normalizeApiBaseOverride,
  persistLocalApiBaseOverride,
} from '../utils/apiClient';
import { MOBILE_APP_DISPLAY_NAME, MOBILE_APP_VERSION, isNativeAppRuntime } from '../utils/mobileAppRuntime';
import {
  authenticateMobileOfflineAccount,
  rememberMobileOfflineAccount,
} from '../utils/mobileOfflineAuth';
import { getClientDeviceMetadata } from '../utils/clientOrderId';
import {
  AlertTriangle,
  CheckCircle,
  Eye,
  EyeOff,
  Lock,
  LogIn,
  Mail,
  Phone,
  RefreshCw,
  Server,
  ShieldCheck,
  Store,
  User,
  UserPlus,
  XCircle,
} from 'lucide-react';

const initialForm = {
  name: '',
  email: 'dongphuongqc@gmail.com',
  phone: '0904045075',
  password: 'khongnoiduoc',
  confirmPassword: 'khongnoiduoc',
  serverUrl: '',
};

const normalizeEmail = (email) => email.trim().toLowerCase();
const normalizePhone = (phone) => phone.replace(/\s/g, '');
const getInitialServerUrl = () => getApiBase() || getLocalApiBaseOverride() || '';

export default function Login({ onLogin, bootstrapStatus, onBootstrapStatus }) {
  const navigate = useNavigate();
  const [form, setForm] = useState(() => ({ ...initialForm, serverUrl: getInitialServerUrl() }));
  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [checkingSetup, setCheckingSetup] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [authMode, setAuthMode] = useState('login');
  const [authModeTouched, setAuthModeTouched] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [restoreStats, setRestoreStats] = useState(null);
  const [restoreError, setRestoreError] = useState('');

  const handleRestoreScan = async () => {
    setRestoreLoading(true);
    setRestoreStats(null);
    setRestoreError('');
    setError('');
    setSuccess('');
    try {
      if (!applyServerOverride()) return;
      const data = await authApi.restoreScan();
      if (data.ok) {
        setRestoreStats(data);
        setSuccess('Đã khôi phục dữ liệu database tốt nhất thành công!');
        const status = await authApi.bootstrapStatus();
        applyBootstrapStatus(status);
      } else {
        setRestoreError(data.message || 'Không tìm thấy file database chứa dữ liệu hoặc backup.');
      }
    } catch (err) {
      setRestoreError(getApiErrorMessage(err?.data, err.message || 'Lỗi khôi phục dữ liệu.'));
    } finally {
      setRestoreLoading(false);
    }
  };

  const set = (key, value) => {
    setForm(current => ({ ...current, [key]: value }));
    setError('');
    setSuccess('');
  };

  const applyBootstrapStatus = (data) => {
    const nextNeedsSetup = !!data?.needsSetup;
    setNeedsSetup(nextNeedsSetup);
    if (!authModeTouched) setAuthMode(nextNeedsSetup ? 'setup' : 'login');
    onBootstrapStatus?.(data || null);
  };

  const switchAuthMode = (mode) => {
    setAuthMode(mode);
    setAuthModeTouched(true);
    setError('');
    setSuccess('');
  };

  const applyServerOverride = ({ allowEmpty = true } = {}) => {
    const rawServerUrl = String(form.serverUrl || '').trim();
    if (!rawServerUrl) {
      if (allowEmpty) {
        clearLocalApiBaseOverride();
        setForm(current => ({ ...current, serverUrl: getApiBase() || '' }));
        return true;
      }
      setError('Vui lòng nhập địa chỉ máy chủ API.');
      return false;
    }

    const normalizedServerUrl = normalizeApiBaseOverride(rawServerUrl);
    if (!normalizedServerUrl) {
      setError('Địa chỉ máy chủ không hợp lệ. Ví dụ: https://tenmien.com/api hoặc http://192.168.1.10:3001/api');
      return false;
    }

    persistLocalApiBaseOverride(normalizedServerUrl);
    setForm(current => ({ ...current, serverUrl: normalizedServerUrl }));
    return true;
  };

  const checkBootstrapStatus = async () => {
    setCheckingSetup(true);
    setError('');
    setSuccess('');

    try {
      if (!applyServerOverride()) return;
      const data = await authApi.bootstrapStatus();
      applyBootstrapStatus(data);
    } catch (err) {
      setNeedsSetup(false);
      setError(getApiErrorMessage(err?.data, err.message || 'Không thể kết nối server để kiểm tra trạng thái thiết lập.'));
      onBootstrapStatus?.({ ok: false, needsSetup: false, message: err.message });
    } finally {
      setCheckingSetup(false);
    }
  };

  useEffect(() => {
    let mounted = true;

    (async () => {
      if (bootstrapStatus) {
        applyBootstrapStatus(bootstrapStatus);
        setCheckingSetup(false);
        return;
      }

      setCheckingSetup(true);
      try {
        const data = await authApi.bootstrapStatus();
        if (!mounted) return;
        applyBootstrapStatus(data);
      } catch (err) {
        if (!mounted) return;
        setNeedsSetup(false);
        setError(getApiErrorMessage(err?.data, err.message || 'Không thể kết nối server để kiểm tra trạng thái thiết lập.'));
        onBootstrapStatus?.({ ok: false, needsSetup: false, message: err.message });
      } finally {
        if (mounted) setCheckingSetup(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [bootstrapStatus, onBootstrapStatus]);

  const completeLogin = async (payload) => {
    if (!payload?.token || !payload?.user) {
      throw new Error('Server không trả đủ thông tin đăng nhập.');
    }
    const result = await onLogin?.(payload);
    navigate(result?.defaultRoute || '/', { replace: true });
  };

  const validateLogin = () => {
    if (!form.email.trim()) {
      setError('Vui lòng nhập email.');
      return false;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      setError('Email không hợp lệ.');
      return false;
    }

    if (!form.password) {
      setError('Vui lòng nhập mật khẩu.');
      return false;
    }

    return true;
  };

  const validateAdminForm = () => {
    if (!form.name.trim()) {
      setError('Vui lòng nhập họ và tên quản trị viên.');
      return false;
    }

    if (form.name.trim().length < 2) {
      setError('Họ và tên phải có ít nhất 2 ký tự.');
      return false;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      setError('Email quản trị không hợp lệ.');
      return false;
    }

    if (!/^0\d{9,10}$/.test(normalizePhone(form.phone))) {
      setError('Số điện thoại phải bắt đầu bằng 0 và gồm 10-11 chữ số.');
      return false;
    }

    if (form.password.length < 6) {
      setError('Mật khẩu phải có ít nhất 6 ký tự.');
      return false;
    }

    if (form.password !== form.confirmPassword) {
      setError('Xác nhận mật khẩu không khớp.');
      return false;
    }

    return true;
  };

  const loginWithCredentials = async (email, password) => {
    try {
      const data = await authApi.login({
        email: normalizeEmail(email),
        password,
        ...getClientDeviceMetadata(),
      });

      if (!data.token || !data.user) {
        throw new Error('Server không trả đủ thông tin đăng nhập.');
      }

      await rememberMobileOfflineAccount({ email, password, payload: data });
      return data;
    } catch (err) {
      const localPayload = await authenticateMobileOfflineAccount(email, password);
      if (localPayload) return localPayload;
      throw err;
    }
  };

  const handleLogin = async (event) => {
    event.preventDefault();
    setError('');
    setSuccess('');

    if (!validateLogin()) return;
    if (!applyServerOverride()) return;

    setLoading(true);
    try {
      const data = await loginWithCredentials(form.email, form.password);
      setSuccess(data.localOnly
        ? 'Đăng nhập cục bộ trên điện thoại thành công.'
        : 'Đăng nhập thành công. Đang khôi phục phiên từ server...');
      await completeLogin(data);
    } catch (err) {
      setError(getApiErrorMessage(err?.data, err.message || 'Không thể kết nối server để đăng nhập.'));
    } finally {
      setLoading(false);
    }
  };

  const handleBootstrapAdmin = async (event) => {
    event.preventDefault();
    setError('');
    setSuccess('');

    if (!needsSetup) {
      setError('Hệ thống đã có tài khoản quản trị viên. Vui lòng đăng nhập.');
      return;
    }

    if (!validateAdminForm()) return;

    const payload = {
      name: form.name.trim(),
      email: normalizeEmail(form.email),
      phone: form.phone.trim(),
      password: form.password,
      ...getClientDeviceMetadata(),
    };

    if (!applyServerOverride()) return;

    setLoading(true);
    try {
      const data = await authApi.bootstrapAdmin(payload);
      setSuccess(data.message ? `${data.message}. Đang đăng nhập...` : 'Tạo tài khoản quản trị viên đầu tiên thành công. Đang đăng nhập...');
      await completeLogin(data);
    } catch (err) {
      setError(getApiErrorMessage(err?.data, err.message || 'Không thể kết nối server để tạo quản trị viên đầu tiên.'));
      await checkBootstrapStatus();
    } finally {
      setLoading(false);
    }
  };

  const showSetupForm = needsSetup && authMode === 'setup';
  const isLoginDisabled = loading || checkingSetup || !form.email.trim() || !form.password;
  const isBootstrapDisabled = loading || checkingSetup || !showSetupForm;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-gray-900 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-blue-100 rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-lg">
            {showSetupForm ? <ShieldCheck className="text-amber-600" size={32} /> : <Store className="text-blue-600" size={32} />}
          </div>
          <h1 className="text-2xl font-bold text-gray-800">Phần mềm POS Offline</h1>
          <p className="text-blue-600 font-semibold mt-1">
            {checkingSetup ? 'Đang kiểm tra hệ thống...' : showSetupForm ? 'Thiết lập lần đầu' : 'Đăng nhập hệ thống'}
          </p>
          {isNativeAppRuntime() && (
            <div className="mt-2 text-xs font-bold text-emerald-700">{MOBILE_APP_DISPLAY_NAME} {MOBILE_APP_VERSION}</div>
          )}
        </div>

        {checkingSetup ? (
          <div className="text-center py-8 text-gray-500 text-sm">
            <RefreshCw className="animate-spin mx-auto mb-3 text-blue-600" size={28} />
            Đang kiểm tra trạng thái thiết lập...
          </div>
        ) : (
          <>
            {success && (
              <div className="mb-4 flex items-start gap-2 bg-green-50 border border-green-200 text-green-700 rounded-xl px-4 py-3 text-sm">
                <CheckCircle size={18} className="shrink-0 mt-0.5" />
                <div>{success}</div>
              </div>
            )}

            {error && (
              <div className="mb-4 flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
                <XCircle size={18} className="shrink-0 mt-0.5" />
                <div className="flex-1">{error}</div>
                <button
                  type="button"
                  onClick={checkBootstrapStatus}
                  className="text-xs font-semibold text-red-700 underline decoration-red-300 hover:text-red-900"
                >
                  Thử lại
                </button>
              </div>
            )}

            <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                <span className="inline-flex items-center gap-1"><Server size={14} /> Kết nối máy tính / server</span>
              </label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="text"
                  inputMode="url"
                  value={form.serverUrl}
                  onChange={event => set('serverUrl', event.target.value)}
                  placeholder="http://192.168.1.19:5174/api"
                  className="input-field min-w-0 flex-1"
                  autoComplete="url"
                />
                <button
                  type="button"
                  onClick={checkBootstrapStatus}
                  disabled={loading || checkingSetup}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-blue-200 px-3 text-sm font-bold text-blue-700 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <RefreshCw size={16} className={checkingSetup ? 'animate-spin' : ''} />
                  Kiểm tra
                </button>
              </div>
              <div className="mt-2 text-xs leading-relaxed text-slate-500">
                Nếu máy tính đang mở, app sẽ kết nối để đồng bộ dữ liệu. Nếu máy tính tắt hoặc đang ở Wi-Fi khác, app vẫn có thể đăng nhập cục bộ bằng tài khoản đã lưu/default.
              </div>
            </div>

            {needsSetup && (
              <div className="mb-4 grid grid-cols-2 gap-2 rounded-xl bg-amber-50 p-1">
                <button
                  type="button"
                  onClick={() => switchAuthMode('setup')}
                  className={`rounded-lg px-3 py-2 text-sm font-bold transition ${showSetupForm ? 'bg-amber-600 text-white shadow-sm' : 'text-amber-800 hover:bg-amber-100'}`}
                >
                  Thiết lập máy này
                </button>
                <button
                  type="button"
                  onClick={() => switchAuthMode('login')}
                  className={`rounded-lg px-3 py-2 text-sm font-bold transition ${!showSetupForm ? 'bg-blue-600 text-white shadow-sm' : 'text-blue-700 hover:bg-blue-50'}`}
                >
                  Đăng nhập tài khoản đã có
                </button>
              </div>
            )}

            {showSetupForm ? (
              <form onSubmit={handleBootstrapAdmin} className="space-y-4">
                <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3 text-sm flex items-start gap-2">
                  <AlertTriangle size={18} className="shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold">Hệ thống chưa có quản trị viên.</div>
                    <div>Vui lòng tạo tài khoản admin đầu tiên. Sau khi tạo thành công, phiên sẽ được khôi phục và đồng bộ từ server.</div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    <span className="inline-flex items-center gap-1"><User size={14} /> Họ và tên <span className="text-red-500">*</span></span>
                  </label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={event => set('name', event.target.value)}
                    placeholder="VD: Nguyễn Văn A"
                    className="input-field w-full pl-4"
                    autoComplete="name"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    <span className="inline-flex items-center gap-1"><Mail size={14} /> Email quản trị <span className="text-red-500">*</span></span>
                  </label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={event => set('email', event.target.value)}
                    placeholder="admin@cuahang.com"
                    className="input-field w-full pl-4"
                    autoComplete="email"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    <span className="inline-flex items-center gap-1"><Phone size={14} /> Số điện thoại <span className="text-red-500">*</span></span>
                  </label>
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={event => set('phone', event.target.value)}
                    placeholder="0909 123 456"
                    className="input-field w-full pl-4"
                    autoComplete="tel"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    <span className="inline-flex items-center gap-1"><Lock size={14} /> Mật khẩu <span className="text-red-500">*</span></span>
                  </label>
                  <div className="relative">
                    <input
                      type={showPass ? 'text' : 'password'}
                      value={form.password}
                      onChange={event => set('password', event.target.value)}
                      placeholder="Tối thiểu 6 ký tự"
                      className="input-field w-full pl-4 pr-10"
                      autoComplete="new-password"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass(current => !current)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      aria-label={showPass ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                    >
                      {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    <span className="inline-flex items-center gap-1"><Lock size={14} /> Xác nhận mật khẩu <span className="text-red-500">*</span></span>
                  </label>
                  <div className="relative">
                    <input
                      type={showConfirm ? 'text' : 'password'}
                      value={form.confirmPassword}
                      onChange={event => set('confirmPassword', event.target.value)}
                      placeholder="Nhập lại mật khẩu"
                      className="input-field w-full pl-4 pr-10"
                      autoComplete="new-password"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirm(current => !current)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      aria-label={showConfirm ? 'Ẩn xác nhận mật khẩu' : 'Hiện xác nhận mật khẩu'}
                    >
                      {showConfirm ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isBootstrapDisabled}
                  className="w-full bg-amber-600 hover:bg-amber-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white py-3 rounded-xl font-bold text-lg transition flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <><RefreshCw size={20} className="animate-spin" /> Đang tạo quản trị viên...</>
                  ) : (
                    <><UserPlus size={20} /> Tạo quản trị viên đầu tiên</>
                  )}
                </button>

                <Link to="/dang-ky" className="w-full border border-amber-200 text-amber-700 hover:bg-amber-50 py-2.5 rounded-xl font-semibold transition flex items-center justify-center gap-2 text-sm">
                  Mở trang đăng ký lần đầu riêng
                </Link>
              </form>
            ) : (
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    <span className="inline-flex items-center gap-1"><Mail size={14} /> Email</span>
                  </label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={event => set('email', event.target.value)}
                    placeholder="nguyenvana@gmail.com"
                    className="input-field w-full pl-4"
                    autoComplete="email"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    <span className="inline-flex items-center gap-1"><Lock size={14} /> Mật khẩu</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showPass ? 'text' : 'password'}
                      value={form.password}
                      onChange={event => set('password', event.target.value)}
                      placeholder="••••••••"
                      className="input-field w-full pl-4 pr-10"
                      autoComplete="current-password"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass(current => !current)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      aria-label={showPass ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                    >
                      {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isLoginDisabled}
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white py-3 rounded-xl font-bold text-lg transition flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <><RefreshCw size={20} className="animate-spin" /> Đang đăng nhập...</>
                  ) : (
                    <><LogIn size={20} /> Đăng nhập</>
                  )}
                </button>

                <Link to="/dang-ky" className="w-full border border-blue-200 text-blue-700 hover:bg-blue-50 py-2.5 rounded-xl font-semibold transition flex items-center justify-center gap-2 text-sm">
                  <UserPlus size={16} /> Đăng ký
                </Link>
              </form>
            )}

            {/* Khôi phục dữ liệu section */}
            <div className="mt-4 pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={handleRestoreScan}
                disabled={restoreLoading || loading || checkingSetup}
                className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white py-2.5 rounded-xl font-bold text-sm transition flex items-center justify-center gap-2 shadow-sm"
              >
                {restoreLoading ? (
                  <><RefreshCw size={16} className="animate-spin" /> Đang khôi phục dữ liệu...</>
                ) : (
                  <>Khôi phục dữ liệu</>
                )}
              </button>
              {restoreStats && (
                <div className="mt-3 bg-emerald-50 border border-emerald-100 rounded-xl p-3 text-xs text-emerald-800 space-y-1">
                  <div className="font-semibold text-emerald-950">Khôi phục thành công database:</div>
                  <div className="font-mono text-[10px] break-all text-emerald-900">{restoreStats.path}</div>
                  <div className="grid grid-cols-3 gap-1 pt-1.5 text-center font-semibold">
                    <div className="bg-white/80 rounded px-1.5 py-1 border border-emerald-100">
                      <div>Sản phẩm</div>
                      <div className="text-sm font-bold text-emerald-700">{restoreStats.productsCount}</div>
                    </div>
                    <div className="bg-white/80 rounded px-1.5 py-1 border border-emerald-100">
                      <div>Khách hàng</div>
                      <div className="text-sm font-bold text-emerald-700">{restoreStats.customersCount}</div>
                    </div>
                    <div className="bg-white/80 rounded px-1.5 py-1 border border-emerald-100">
                      <div>Đơn hàng</div>
                      <div className="text-sm font-bold text-emerald-700">{restoreStats.invoicesCount}</div>
                    </div>
                  </div>
                </div>
              )}
              {restoreError && (
                <div className="mt-2 text-xs font-semibold text-red-600 bg-red-50 border border-red-100 rounded-lg p-2 flex items-center gap-1.5">
                  <XCircle size={14} className="shrink-0" />
                  <span>{restoreError}</span>
                </div>
              )}
            </div>

            <div className="mt-6 bg-blue-50 rounded-xl p-4 text-xs text-blue-700">
              {showSetupForm ? (
                <div>Lần đầu sử dụng: tài khoản đầu tiên sẽ được server tự động cấp quyền ADMIN.</div>
              ) : needsSetup ? (
                <div>Server hiện tại đang trống dữ liệu. Để đăng nhập tài khoản đã có, hãy nhập đúng địa chỉ server đang lưu tài khoản rồi bấm Kiểm tra hoặc Đăng nhập.</div>
              ) : (
                <div>Tài khoản mặc định đã được điền sẵn. Bấm Đăng nhập để dùng trên điện thoại, kể cả khi chưa kết nối máy tính.</div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
