import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  authApi,
  getApiBase,
  getApiErrorMessage,
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
const getInitialServerUrl = () => getApiBase() || '';

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
    setRestoreFiles([]);
    setRestoreError('');
    setError('');
    setSuccess('');
    try {
      if (!applyServerOverride()) return;
      const data = await authApi.recoveryScan.scan();
      if (data && data.ok) {
        setRestoreFiles(data.files || []);
        setSuccess(`Đã quét xong: tìm thấy ${data.total || 0} file backup. Bấm "Bắt đầu khôi phục" để import.`);
      } else {
        setRestoreError((data && data.message) || 'Không tìm thấy file backup.');
      }
    } catch (err) {
      const netData = err?.data;
      if (netData && netData.isNetworkError) setRestoreError('Không kết nối được backend.');
      else if (netData && netData.message) setRestoreError(netData.message);
      else if (err && err.message && /fetch|network|connect|ECONN|localhost|127\.0\.0\.1|api base/i.test(err.message)) setRestoreError('Không kết nối được backend.');
      else setRestoreError(getApiErrorMessage(netData, 'Quét backup thất bại.'));
    } finally {
      setRestoreLoading(false);
    }
  };

  const handleStartRestore = async () => {
    if (!restoreFiles.length) {
      setRestoreError('Hãy bấm "Quét file backup" trước khi khôi phục.');
      return;
    }
    if (!window.confirm(`Bắt đầu khôi phục ${restoreFiles.length} file backup? Dữ liệu hiện tại sẽ được snapshot trước, không replace database.`)) return;
    setRestoreLoading(true);
    setRestoreStats(null);
    setRestoreError('');
    setSuccess('');
    try {
      const data = await authApi.recoveryScan.restore({ files: restoreFiles });
      if (data && data.ok) {
        setRestoreStats(data.report || data);
        setSuccess(data.message || 'Đã khôi phục dữ liệu thành công.');
        try {
          const status = await authApi.bootstrapStatus();
          applyBootstrapStatus(status);
        } catch (_) {}
      } else {
        setRestoreError((data && data.message) || 'Khôi phục thất bại, dữ liệu hiện tại đã được giữ nguyên.');
      }
    } catch (err) {
      const netData = err?.data;
      if (netData && netData.isNetworkError) setRestoreError('Không kết nối được backend.');
      else if (netData && netData.message) setRestoreError(netData.message);
      else setRestoreError(getApiErrorMessage(netData, 'Khôi phục thất bại, dữ liệu hiện tại đã được giữ nguyên.'));
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

  const applyServerOverride = () => true;

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
      setError(getApiErrorMessage(err?.data, err.message || 'Không thể kết nối backend để kiểm tra trạng thái thiết lập.'));
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
        setError(getApiErrorMessage(err?.data, err.message || 'Không thể kết nối backend để kiểm tra trạng thái thiết lập.'));
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
    const input = form.email.trim();
    if (!input) {
      setError('Vui lòng nhập email hoặc số điện thoại.');
      return false;
    }

    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input);
    const isPhone = /^0\d{9,10}$/.test(normalizePhone(input));

    if (!isEmail && !isPhone) {
      setError('Email hoặc số điện thoại không hợp lệ.');
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

    if (form.password.length < 8) {
      setError('Mật khẩu phải có ít nhất 8 ký tự.');
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
        ? 'Đang nhập các bản trên điện thoại thành công.'
        : 'Đăng nhập thành công. Đang khôi phục phiên từ server...');
      await completeLogin(data);
    } catch (err) {
      const netData = err?.data;
      if (netData && netData.isNetworkError) {
        setError('Không kết nối được backend.');
      } else if (netData && netData.message) {
        // Lỗi từ backend rõ ràng (vd: sai tài khoản/mật khẩu)
        const m = String(netData.message);
        setError(/sai|không chính xác|không đúng|invalid|unauthor/i.test(m) ? 'Tài khoản hoặc mật khẩu không chính xác.' : m);
      } else if (err && err.message && /fetch|network|connect|ECONN|localhost|127\.0\.0\.1|api base/i.test(err.message)) {
        setError('Không kết nối được backend.');
      } else {
        setError(getApiErrorMessage(netData, 'Tài khoản hoặc mật khẩu không chính xác.'));
      }
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
      setSuccess(data.message ? `${data.message}. đang đăng nhập...` : 'Tạo tài khoản quản trị viên đầu tiên thành công. Đang đăng nhập...');
      await completeLogin(data);
    } catch (err) {
      setError(getApiErrorMessage(err?.data, err.message || 'Không kết nối được backend để tạo quản trị viên đầu tiên.'));
    } finally {
      setLoading(false);
    }
  };

  // -------------------------- Đăng ký tài khoản mới --------------------------
  const handleRegister = async (event) => {
    event.preventDefault();
    setError('');
    setSuccess('');

    // Sử dụng cùng hàm kiểm tra như admin
    if (!validateAdminForm()) return;
    if (form.password !== form.confirmPassword) {
      setError('Mật khẩu và xác nhận không khớp.');
      return;
    }

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
      const data = await authApi.register(payload);
      setSuccess('Tạo tài khoản thành công. Đang đăng nhập...');
      // Lưu tài khoản offline để có thể đăng nhập trên các máy khác
      await rememberMobileOfflineAccount({ email: form.email, password: form.password, payload: data });
      await completeLogin(data);
    } catch (err) {
      setError(getApiErrorMessage(err?.data, err.message || 'Không thể đăng ký.'));
    } finally {
      setLoading(false);
    }
  };

  const showSetupForm = needsSetup && authMode === 'setup';
  const isLoginDisabled = loading || !form.email.trim() || !form.password;
  const isBootstrapDisabled = loading || checkingSetup || !showSetupForm;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-gray-900 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-lg overflow-hidden bg-slate-50 border border-slate-100">
            <img src="/icons/app-icon-192.png" alt="POS Logo" className="w-full h-full object-cover" />
          </div>
          <h1 className="text-2xl font-bold text-gray-800">Bán Hàng POS</h1>
          <p className="text-blue-600 font-semibold mt-1">
            {checkingSetup ? 'Đang kiểm tra hệ thống...' : showSetupForm ? 'Thiết lập lần đầu' : 'Đăng nhập hệ thống'}
          </p>
          {isNativeAppRuntime() && (
            <div className="mt-2 text-xs font-bold text-emerald-700">{MOBILE_APP_DISPLAY_NAME} {MOBILE_APP_VERSION}</div>
          )}
        </div>

        {checkingSetup && (
          <div className="mb-3 flex items-center justify-center gap-2 text-xs text-gray-400">
            <RefreshCw className="animate-spin" size={14} />
            đang kiểm tra trạng thái thiết lập...
          </div>
        )}
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


            {/* Toggle between Đăng ký, Đăng nhập, và Thiết lập (nếu cần) */}
            <div className="mb-4 grid grid-cols-3 gap-2 rounded-xl bg-amber-50 p-1">
              {/* Đăng ký - luôn hiển thị nếu không ở chế độ setup */}
              {!showSetupForm && (
                <button
                  type="button"
                  onClick={() => switchAuthMode('register')}
                  className="rounded-lg px-3 py-2 text-sm font-bold text-green-800 hover:bg-green-100"
                >
                  Đăng ký
                </button>
              )}
              {/* Đăng nhập */}
              <button
                type="button"
                onClick={() => switchAuthMode('login')}
                className={`rounded-lg px-3 py-2 text-sm font-bold transition ${authMode === 'login' ? 'bg-blue-600 text-white shadow-sm' : 'text-blue-700 hover:bg-blue-50'}`}
              >
                Đăng nhập tài khoản đã có
              </button>
              {/* Thiết lập admin nếu cần */}
              {needsSetup && (
                <button
                  type="button"
                  onClick={() => switchAuthMode('setup')}
                  className={`rounded-lg px-3 py-2 text-sm font-bold transition ${authMode === 'setup' ? 'bg-amber-600 text-white shadow-sm' : 'text-amber-800 hover:bg-amber-100'}`}
                >
                  Thiết lập máy này
                </button>
              )}
            </div>

            {showSetupForm && (
              <form onSubmit={handleBootstrapAdmin} className="space-y-4">
                <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3 text-sm flex items-start gap-2">
                  <AlertTriangle size={18} className="shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold">Hệ thống chưa có quản trị viên.</div>
                    <div>Vui lòng tạo tài khoản admin đầu tiên. Sau khi tạo thành công, phiên sẽ được khôi phục và dùng bản từ server.</div>
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
              )}
            {/* Form đăng ký tài khoản mới */}
            {authMode === 'register' && (
              <form onSubmit={handleRegister} className="space-y-4">
                <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3 text-sm flex items-start gap-2">
                  <AlertTriangle size={18} className="shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold">Đăng ký tài khoản</div>
                    <div>Nhập thông tin để tạo tài khoản mới.</div>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    <span className="inline-flex items-center gap-1"><User size={14} /> Họ và tên <span className="text-red-500">*</span></span>
                  </label>
                  <input type="text" value={form.name} onChange={e => set('name', e.target.value)} placeholder="VD: Nguyễn Văn A" className="input-field w-full pl-4" autoComplete="name" required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    <span className="inline-flex items-center gap-1"><Mail size={14} /> Email <span className="text-red-500">*</span></span>
                  </label>
                  <input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="user@domain.com" className="input-field w-full pl-4" autoComplete="email" required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    <span className="inline-flex items-center gap-1"><Phone size={14} /> Số điện thoại <span className="text-red-500">*</span></span>
                  </label>
                  <input type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="0909 123 456" className="input-field w-full pl-4" autoComplete="tel" required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    <span className="inline-flex items-center gap-1"><Lock size={14} /> Mật khẩu <span className="text-red-500">*</span></span>
                  </label>
                  <div className="relative">
                    <input type={showPass ? 'text' : 'password'} value={form.password} onChange={e => set('password', e.target.value)} placeholder="Tối thiểu 6 ký tự" className="input-field w-full pl-4 pr-10" autoComplete="new-password" required />
                    <button type="button" onClick={() => setShowPass(p => !p)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600" aria-label={showPass ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}>
                      {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    <span className="inline-flex items-center gap-1"><Lock size={14} /> Xác nhận mật khẩu <span className="text-red-500">*</span></span>
                  </label>
                  <div className="relative">
                    <input type={showConfirm ? 'text' : 'password'} value={form.confirmPassword} onChange={e => set('confirmPassword', e.target.value)} placeholder="Nhập lại mật khẩu" className="input-field w-full pl-4 pr-10" autoComplete="new-password" required />
                    <button type="button" onClick={() => setShowConfirm(p => !p)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600" aria-label={showConfirm ? 'Ẩn xác nhận' : 'Hiện xác nhận'}>
                      {showConfirm ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>
                <button type="submit" disabled={loading} className="w-full bg-green-600 hover:bg-green-700 text-white py-3 rounded-xl font-bold text-lg transition flex items-center justify-center gap-2">
                  {loading ? 'Đang lưu...' : 'Đăng ký'}
                </button>
              </form>
            )}
            {authMode === 'login' && (
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    <span className="inline-flex items-center gap-1"><Mail size={14} /> Email hoặc số điện thoại</span>
                  </label>
                  <input
                    type="text"
                    value={form.email}
                    onChange={event => set('email', event.target.value)}
                    placeholder="nguyenvana@gmail.com hoặc 0904045075"
                    className="input-field w-full pl-4"
                    autoComplete="username"
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
                      placeholder="Nhập mật khẩu"
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
                    <><RefreshCw size={20} className="animate-spin" /> đang đăng nhập...</>
                  ) : (
                    <><LogIn size={20} /> Đăng nhập</>
                  )}
                </button>

                <Link to="/dang-ky" className="w-full border border-blue-200 text-blue-700 hover:bg-blue-50 py-2.5 rounded-xl font-semibold transition flex items-center justify-center gap-2 text-sm">
                  <UserPlus size={16} /> Đăng ký tài khoản mới
                </Link>
              </form>
            )}

            {/* Khôi phục dữ liệu section */}
            <div className="mt-4 pt-4 border-t border-slate-100">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleRestoreScan}
                  disabled={restoreLoading || loading || checkingSetup}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white py-2.5 rounded-xl font-bold text-sm transition flex items-center justify-center gap-2 shadow-sm"
                >
                  {restoreLoading && !restoreFiles.length ? (
                    <><RefreshCw size={16} className="animate-spin" /> Đang quét file...</>
                  ) : (
                    <>Quét file backup</>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleStartRestore}
                  disabled={restoreLoading || !restoreFiles.length || loading || checkingSetup}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white py-2.5 rounded-xl font-bold text-sm transition flex items-center justify-center gap-2 shadow-sm"
                >
                  {restoreLoading && restoreFiles.length > 0 ? (
                    <><RefreshCw size={16} className="animate-spin" /> Đang khôi phục...</>
                  ) : (
                    <>Bắt đầu khôi phục</>
                  )}
                </button>
              </div>
              {restoreFiles.length > 0 && !restoreLoading && (
                <div className="mt-2 text-xs text-blue-700 bg-blue-50 rounded-lg px-3 py-2">
                  <span className="font-semibold">{restoreFiles.length} file backup</span> đã quét được. Bấm "Bắt đầu khôi phục" để import.
                </div>
              )}
              {restoreStats && (
                <div className="mt-3 bg-emerald-50 border border-emerald-100 rounded-xl p-3 text-xs text-emerald-800 space-y-1">
                  <div className="font-semibold text-emerald-950">Khôi phục hoàn tất:</div>
                  <div className="grid grid-cols-3 gap-1 pt-1.5 text-center font-semibold">
                    <div className="bg-white/80 rounded px-1.5 py-1 border border-emerald-100">
                      <div>Sản phẩm</div>
                      <div className="text-sm font-bold text-emerald-700">{restoreStats.restoredCounts?.products || 0}</div>
                    </div>
                    <div className="bg-white/80 rounded px-1.5 py-1 border border-emerald-100">
                      <div>Khách hàng</div>
                      <div className="text-sm font-bold text-emerald-700">{restoreStats.restoredCounts?.customers || 0}</div>
                    </div>
                    <div className="bg-white/80 rounded px-1.5 py-1 border border-emerald-100">
                      <div>Đơn hàng</div>
                      <div className="text-sm font-bold text-emerald-700">{restoreStats.restoredCounts?.invoices || 0}</div>
                    </div>
                  </div>
                  <div className="pt-1.5 text-[11px] text-emerald-700">
                    File đã xử lý: {restoreStats.parsedFiles?.length || 0}; file lỗi/bỏ qua: {restoreStats.failedFiles?.length || 0}; rollback: {restoreStats.rollbackStatus || 'not_needed'}.
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
                <div>Server hiện tại đang trống dữ liệu. Để đăng nhập tài khoản đã có, hãy nhập đúng địa chỉ server đang lưu tài khoản rồi bấm Kiểm tra hoặc đăng nhập.</div>
              ) : (
                <div>Tài khoản mặc định đã được điền sẵn. Bấm Đăng nhập để vào hệ thống.</div>
              )}
            </div>
          </>
      </div>
    </div>
  );
}





