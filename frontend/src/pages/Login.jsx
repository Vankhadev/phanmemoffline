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
    setRestoreError('');
    setError('');
    setSuccess('');
    try {
      if (!applyServerOverride()) return;
      const data = await authApi.restoreScan();
      if (data.ok) {
        setRestoreStats(data);
        setSuccess('?? kh?i ph?c dữ liệu database t?t nh?t th?nh c?ng!');
        const status = await authApi.bootstrapStatus();
        applyBootstrapStatus(status);
      } else {
        setRestoreError(data.message || 'Kh?ng t?m th?y file database ch?a dữ liệu ho?c backup.');
      }
    } catch (err) {
      setRestoreError(getApiErrorMessage(err?.data, err.message || 'L?i kh?i ph?c dữ liệu.'));
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
      setError(getApiErrorMessage(err?.data, err.message || 'Kh?ng th? kết nối server d? ki?m tra tr?ng th?i thi?t l?p.'));
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
        setError(getApiErrorMessage(err?.data, err.message || 'Kh?ng th? kết nối server d? ki?m tra tr?ng th?i thi?t l?p.'));
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
      throw new Error('Server kh?ng tr? d? th?ng tin đăng nhập.');
    }
    const result = await onLogin?.(payload);
    navigate(result?.defaultRoute || '/', { replace: true });
  };

  const validateLogin = () => {
    const input = form.email.trim();
    if (!input) {
      setError('Vui l?ng nh?p email ho?c s? di?n tho?i.');
      return false;
    }

    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input);
    const isPhone = /^0\d{9,10}$/.test(normalizePhone(input));

    if (!isEmail && !isPhone) {
      setError('Email ho?c S? di?n tho?i kh?ng h?p l?.');
      return false;
    }

    if (!form.password) {
      setError('Vui l?ng nh?p m?t kh?u.');
      return false;
    }

    return true;
  };

  const validateAdminForm = () => {
    if (!form.name.trim()) {
      setError('Vui l?ng nh?p h? v? t?n qu?n tr? vi?n.');
      return false;
    }

    if (form.name.trim().length < 2) {
      setError('H? v? t?n ph?i c? ?t nh?t 2 k? t?.');
      return false;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      setError('Email qu?n tr? kh?ng h?p l?.');
      return false;
    }

    if (!/^0\d{9,10}$/.test(normalizePhone(form.phone))) {
      setError('S? di?n tho?i ph?i b?t d?u b?ng 0 v? g?m 10-11 ch? s?.');
      return false;
    }

    if (form.password.length < 8) {
      setError('M?t kh?u ph?i c? ?t nh?t 8 k? t?.');
      return false;
    }

    if (form.password !== form.confirmPassword) {
      setError('X?c nh?n m?t kh?u kh?ng kh?p.');
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
        throw new Error('Server kh?ng tr? d? th?ng tin đăng nhập.');
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
        ? 'đang nh?p c?c b? tr?n di?n tho?i th?nh c?ng.'
        : 'đang nh?p th?nh c?ng. đang kh?i ph?c phi?n t? server...');
      await completeLogin(data);
    } catch (err) {
      setError(getApiErrorMessage(err?.data, err.message || 'Kh?ng th? kết nối server d? đăng nhập.'));
    } finally {
      setLoading(false);
    }
  };

  const handleBootstrapAdmin = async (event) => {
    event.preventDefault();
    setError('');
    setSuccess('');

    if (!needsSetup) {
      setError('H? th?ng d? c? tài khoản qu?n tr? vi?n. Vui l?ng đăng nhập.');
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
      setSuccess(data.message ? `${data.message}. đang đăng nhập...` : 'T?o tài khoản qu?n tr? vi?n d?u ti?n th?nh c?ng. đang đăng nhập...');
      await completeLogin(data);
    } catch (err) {
      setError(getApiErrorMessage(err?.data, err.message || 'Kh?ng th? kết nối server d? t?o qu?n tr? vi?n d?u ti?n.'));
    } finally {
      setLoading(false);
    }
  };

  // -------------------------- ÄÄƒng kÃ½ tÃ i khoáº£n má»›i --------------------------
  const handleRegister = async (event) => {
    event.preventDefault();
    setError('');
    setSuccess('');

    // Sá»­ dá»¥ng cÃ¹ng hÃ m kiá»ƒm tra nhÆ° admin
    if (!validateAdminForm()) return;
    if (form.password !== form.confirmPassword) {
      setError('Máº­t kháº©u vÃ  xÃ¡c nháº­n khÃ´ng khá»›p.');
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
      setSuccess('Táº¡o tÃ i khoáº£n thÃ nh cÃ´ng. Äang Ä‘Äƒng nháº­p...');
      // LÆ°u tÃ i khoáº£n offline Ä‘á»ƒ cÃ³ thá»ƒ Ä‘Äƒng nháº­p trÃªn cÃ¡c mÃ¡y khÃ¡c
      await rememberMobileOfflineAccount({ email: form.email, password: form.password, payload: data });
      await completeLogin(data);
    } catch (err) {
      setError(getApiErrorMessage(err?.data, err.message || 'KhÃ´ng thá»ƒ Ä‘Äƒng kÃ½.'));
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
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-lg overflow-hidden bg-slate-50 border border-slate-100">
            <img src="/icons/app-icon-192.png" alt="POS Logo" className="w-full h-full object-cover" />
          </div>
          <h1 className="text-2xl font-bold text-gray-800">B?n H?ng Pos</h1>
          <p className="text-blue-600 font-semibold mt-1">
            {checkingSetup ? 'đang ki?m tra hệ thống...' : showSetupForm ? 'Thi?t l?p l?n d?u' : 'đang nh?p hệ thống'}
          </p>
          {isNativeAppRuntime() && (
            <div className="mt-2 text-xs font-bold text-emerald-700">{MOBILE_APP_DISPLAY_NAME} {MOBILE_APP_VERSION}</div>
          )}
        </div>

        {checkingSetup ? (
          <div className="text-center py-8 text-gray-500 text-sm">
            <RefreshCw className="animate-spin mx-auto mb-3 text-blue-600" size={28} />
            đang ki?m tra tr?ng th?i thi?t l?p...
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
                  Th? l?i
                </button>
              </div>
            )}


            {/* Toggle between ÄÄƒng kÃ½, ÄÄƒng nháº­p, vÃ  Thiáº¿t láº­p (náº¿u cáº§n) */}
            <div className="mb-4 grid grid-cols-3 gap-2 rounded-xl bg-amber-50 p-1">
              {/* ÄÄƒng kÃ½ - luÃ´n hiá»ƒn thá»‹ náº¿u khÃ´ng á»Ÿ cháº¿ Ä‘á»™ setup */}
              {!showSetupForm && (
                <button
                  type="button"
                  onClick={() => switchAuthMode('register')}
                  className="rounded-lg px-3 py-2 text-sm font-bold text-green-800 hover:bg-green-100"
                >
                  ÄÄƒng kÃ½
                </button>
              )}
              {/* ÄÄƒng nháº­p */}
              <button
                type="button"
                onClick={() => switchAuthMode('login')}
                className={`rounded-lg px-3 py-2 text-sm font-bold transition ${authMode === 'login' ? 'bg-blue-600 text-white shadow-sm' : 'text-blue-700 hover:bg-blue-50'}`}
              >
                đang nh?p tài khoản d? c?
              </button>
              {/* Thiáº¿t láº­p admin náº¿u cáº§n */}
              {needsSetup && (
                <button
                  type="button"
                  onClick={() => switchAuthMode('setup')}
                  className={`rounded-lg px-3 py-2 text-sm font-bold transition ${authMode === 'setup' ? 'bg-amber-600 text-white shadow-sm' : 'text-amber-800 hover:bg-amber-100'}`}
                >
                  Thi?t l?p m?y n?y
                </button>
              )}
            </div>

            {showSetupForm && (
              <form onSubmit={handleBootstrapAdmin} className="space-y-4">
                <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3 text-sm flex items-start gap-2">
                  <AlertTriangle size={18} className="shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold">H? th?ng chua c? qu?n tr? vi?n.</div>
                    <div>Vui l?ng t?o tài khoản admin d?u ti?n. Sau khi t?o th?nh c?ng, phi?n s? du?c kh?i ph?c v? d?ng b? t? server.</div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    <span className="inline-flex items-center gap-1"><User size={14} /> H? v? t?n <span className="text-red-500">*</span></span>
                  </label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={event => set('name', event.target.value)}
                    placeholder="VD: Nguy?n Van A"
                    className="input-field w-full pl-4"
                    autoComplete="name"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    <span className="inline-flex items-center gap-1"><Mail size={14} /> Email qu?n tr? <span className="text-red-500">*</span></span>
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
                    <span className="inline-flex items-center gap-1"><Phone size={14} /> S? di?n tho?i <span className="text-red-500">*</span></span>
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
                    <span className="inline-flex items-center gap-1"><Lock size={14} /> M?t kh?u <span className="text-red-500">*</span></span>
                  </label>
                  <div className="relative">
                    <input
                      type={showPass ? 'text' : 'password'}
                      value={form.password}
                      onChange={event => set('password', event.target.value)}
                      placeholder="T?i thi?u 6 k? t?"
                      className="input-field w-full pl-4 pr-10"
                      autoComplete="new-password"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass(current => !current)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      aria-label={showPass ? '?n m?t kh?u' : 'Hi?n m?t kh?u'}
                    >
                      {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    <span className="inline-flex items-center gap-1"><Lock size={14} /> X?c nh?n m?t kh?u <span className="text-red-500">*</span></span>
                  </label>
                  <div className="relative">
                    <input
                      type={showConfirm ? 'text' : 'password'}
                      value={form.confirmPassword}
                      onChange={event => set('confirmPassword', event.target.value)}
                      placeholder="Nh?p l?i m?t kh?u"
                      className="input-field w-full pl-4 pr-10"
                      autoComplete="new-password"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirm(current => !current)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      aria-label={showConfirm ? '?n x?c nh?n m?t kh?u' : 'Hi?n x?c nh?n m?t kh?u'}
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
                    <><RefreshCw size={20} className="animate-spin" /> đang t?o qu?n tr? vi?n...</>
                  ) : (
                    <><UserPlus size={20} /> T?o qu?n tr? vi?n d?u ti?n</>
                  )}
                </button>

                <Link to="/dang-ky" className="w-full border border-amber-200 text-amber-700 hover:bg-amber-50 py-2.5 rounded-xl font-semibold transition flex items-center justify-center gap-2 text-sm">
                  M? trang dang k? l?n d?u ri?ng
                </Link>
                </form>
              )}
            {/* Form Ä‘Äƒng kÃ½ tÃ i khoáº£n má»›i */}
            {authMode === 'register' && (
              <form onSubmit={handleRegister} className="space-y-4">
                <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3 text-sm flex items-start gap-2">
                  <AlertTriangle size={18} className="shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold">ÄÄƒng kÃ½ tÃ i khoáº£n</div>
                    <div>Nháº­p thÃ´ng tin Ä‘á»ƒ táº¡o tÃ i khoáº£n má»›i.</div>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    <span className="inline-flex items-center gap-1"><User size={14} /> Há» vÃ  tÃªn <span className="text-red-500">*</span></span>
                  </label>
                  <input type="text" value={form.name} onChange={e => set('name', e.target.value)} placeholder="VD: Nguyá»…n VÄƒn A" className="input-field w-full pl-4" autoComplete="name" required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    <span className="inline-flex items-center gap-1"><Mail size={14} /> Email <span className="text-red-500">*</span></span>
                  </label>
                  <input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="user@domain.com" className="input-field w-full pl-4" autoComplete="email" required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    <span className="inline-flex items-center gap-1"><Phone size={14} /> Sá»‘ Ä‘iá»‡n thoáº¡i <span className="text-red-500">*</span></span>
                  </label>
                  <input type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="0909 123 456" className="input-field w-full pl-4" autoComplete="tel" required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    <span className="inline-flex items-center gap-1"><Lock size={14} /> Máº­t kháº©u <span className="text-red-500">*</span></span>
                  </label>
                  <div className="relative">
                    <input type={showPass ? 'text' : 'password'} value={form.password} onChange={e => set('password', e.target.value)} placeholder="Tá»‘i thiá»ƒu 6 kÃ½ tá»±" className="input-field w-full pl-4 pr-10" autoComplete="new-password" required />
                    <button type="button" onClick={() => setShowPass(p => !p)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600" aria-label={showPass ? 'áº¨n máº­t kháº©u' : 'Hiá»‡n máº­t kháº©u'}>
                      {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    <span className="inline-flex items-center gap-1"><Lock size={14} /> XÃ¡c nháº­n máº­t kháº©u <span className="text-red-500">*</span></span>
                  </label>
                  <div className="relative">
                    <input type={showConfirm ? 'text' : 'password'} value={form.confirmPassword} onChange={e => set('confirmPassword', e.target.value)} placeholder="Nháº­p láº¡i máº­t kháº©u" className="input-field w-full pl-4 pr-10" autoComplete="new-password" required />
                    <button type="button" onClick={() => setShowConfirm(p => !p)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600" aria-label={showConfirm ? 'áº¨n xÃ¡c nháº­n' : 'Hiá»‡n xÃ¡c nháº­n'}>
                      {showConfirm ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>
                <button type="submit" disabled={loading} className="w-full bg-green-600 hover:bg-green-700 text-white py-3 rounded-xl font-bold text-lg transition flex items-center justify-center gap-2">
                  {loading ? 'Äang lÆ°u...' : 'ÄÄƒng kÃ½'}
                </button>
              </form>
            )}
            {showSetupForm && (
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    <span className="inline-flex items-center gap-1"><Mail size={14} /> Email ho?c S? di?n tho?i</span>
                  </label>
                  <input
                    type="text"
                    value={form.email}
                    onChange={event => set('email', event.target.value)}
                    placeholder="nguyenvana@gmail.com ho?c 0904045075"
                    className="input-field w-full pl-4"
                    autoComplete="username"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    <span className="inline-flex items-center gap-1"><Lock size={14} /> M?t kh?u</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showPass ? 'text' : 'password'}
                      value={form.password}
                      onChange={event => set('password', event.target.value)}
                      placeholder="????????"
                      className="input-field w-full pl-4 pr-10"
                      autoComplete="current-password"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass(current => !current)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      aria-label={showPass ? '?n m?t kh?u' : 'Hi?n m?t kh?u'}
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
                    <><LogIn size={20} /> đang nh?p</>
                  )}
                </button>

                <Link to="/dang-ky" className="w-full border border-blue-200 text-blue-700 hover:bg-blue-50 py-2.5 rounded-xl font-semibold transition flex items-center justify-center gap-2 text-sm">
                  <UserPlus size={16} /> đang k? tài khoản m?i
                </Link>
              </form>
            )}

            {/* Kh?i ph?c dữ liệu section */}
            <div className="mt-4 pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={handleRestoreScan}
                disabled={restoreLoading || loading || checkingSetup}
                className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white py-2.5 rounded-xl font-bold text-sm transition flex items-center justify-center gap-2 shadow-sm"
              >
                {restoreLoading ? (
                  <><RefreshCw size={16} className="animate-spin" /> đang kh?i ph?c dữ liệu...</>
                ) : (
                  <>Kh?i ph?c dữ liệu</>
                )}
              </button>
              {restoreStats && (
                <div className="mt-3 bg-emerald-50 border border-emerald-100 rounded-xl p-3 text-xs text-emerald-800 space-y-1">
                  <div className="font-semibold text-emerald-950">Kh?i ph?c th?nh c?ng database:</div>
                  <div className="font-mono text-[10px] break-all text-emerald-900">{restoreStats.path}</div>
                  <div className="grid grid-cols-3 gap-1 pt-1.5 text-center font-semibold">
                    <div className="bg-white/80 rounded px-1.5 py-1 border border-emerald-100">
                      <div>S?n ph?m</div>
                      <div className="text-sm font-bold text-emerald-700">{restoreStats.productsCount}</div>
                    </div>
                    <div className="bg-white/80 rounded px-1.5 py-1 border border-emerald-100">
                      <div>Kh?ch h?ng</div>
                      <div className="text-sm font-bold text-emerald-700">{restoreStats.customersCount}</div>
                    </div>
                    <div className="bg-white/80 rounded px-1.5 py-1 border border-emerald-100">
                      <div>?on h?ng</div>
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
                <div>L?n d?u s? d?ng: tài khoản d?u ti?n s? du?c server t? d?ng c?p quy?n ADMIN.</div>
              ) : needsSetup ? (
                <div>Server hi?n t?i dang tr?ng dữ liệu. ?? đăng nhập tài khoản d? c?, h?y nh?p d?ng d?a ch? server dang luu tài khoản r?i b?m Ki?m tra ho?c đang nh?p.</div>
              ) : (
                <div>T?i kho?n m?c d?nh d? du?c di?n s?n. B?m đang nh?p d? d?ng tr?n di?n tho?i, k? c? khi chua kết nối m?y t?nh.</div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}


