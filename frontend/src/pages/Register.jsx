import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authApi, getApiErrorMessage } from '../utils/apiClient';
import {
  ArrowLeft,
  CheckCircle,
  Eye,
  EyeOff,
  Info,
  Lock,
  Mail,
  Phone,
  RefreshCw,
  ShieldCheck,
  User,
  UserPlus,
  XCircle,
} from 'lucide-react';

const initialForm = {
  name: 'Vankha',
  email: 'vankhaqc@gmail.com',
  phone: '0904045075',
  password: 'Vankhammo07@',
  confirmPassword: 'Vankhammo07@',
};

const normalizeEmail = (email) => email.trim().toLowerCase();
const normalizePhone = (phone) => phone.replace(/\s/g, '');

export default function Register({ onLogin, bootstrapStatus }) {
  const navigate = useNavigate();
  const [form, setForm] = useState(initialForm);
  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [checkingSetup, setCheckingSetup] = useState(true);
  const [registeredData, setRegisteredData] = useState(null);
  const [currentBootstrapStatus, setCurrentBootstrapStatus] = useState({
    totalUsers: 0,
    hasAdmin: false,
    nextRole: 'ADMIN',
    message: 'Tài khoản đầu ti?n sẽ được c?p quy?n ADMIN',
  });

  const nextRole = String(currentBootstrapStatus.nextRole || (currentBootstrapStatus.needsSetup ? 'ADMIN' : 'USER')).toUpperCase();
  const isFirstAccount = nextRole === 'ADMIN' || !!currentBootstrapStatus.needsSetup;
  const submitDisabled = loading || checkingSetup;

  const pageContent = useMemo(() => {
    if (checkingSetup) {
      return {
        title: 'đang kiểm tra hệ thống',
        description: 'Vui lòng dài trong gi?y l?t trước khi dang k? tài khoản',
      };
    }

    if (registeredData) {
      return {
        title: 'Tạo tài khoản thành công',
        description: 'Tài khoản của b?n d? s?n s?ng sử dụng',
      };
    }

    if (isFirstAccount) {
      return {
        title: 'đang k? tài khoản ',
        description: 'Ch?o M?ng Bản ??n H? Tháng đang K? Tải Kho?n Của Ph?n M?m',
      };
    }

    return {
      title: 'đang k? tài khoản',
      description: 'Ch?o M?ng Bản ??n H? Tháng đang K? Tải Kho?n Của Ph?n M?m',
    };
  }, [checkingSetup, isFirstAccount, registeredData]);

  const set = (key, value) => {
    setForm(current => ({ ...current, [key]: value }));
    setError('');
    setSuccess('');
  };

  const applyBootstrapStatus = (data) => {
    setCurrentBootstrapStatus({
      totalUsers: Number(data?.totalUsers || 0),
      hasAdmin: !!data?.hasAdmin,
      needsSetup: !!data?.needsSetup,
      nextRole: String(data?.nextRole || (data?.needsSetup ? 'ADMIN' : 'USER')).toUpperCase(),
      message: data?.message || (data?.needsSetup ? 'Tài khoản đầu ti?n sẽ được c?p quy?n ADMIN' : 'Tài khoản dang k? ti?p theo s? l? USER'),
    });
  };

  const completeLogin = async (payload) => {
    if (!payload?.token || !payload?.user) {
      throw new Error('Server không tr? d? thông tin đăng nhập.');
    }
    const result = await onLogin?.(payload);
    navigate(result?.defaultRoute || '/', { replace: true });
  };

  const checkBootstrapStatus = useCallback(async () => {
    setCheckingSetup(true);
    setError('');

    try {
      const data = await authApi.bootstrapStatus();
      applyBootstrapStatus(data);
    } catch (err) {
      setCurrentBootstrapStatus(current => ({ ...current, nextRole: 'USER', needsSetup: false }));
      setError(getApiErrorMessage(err?.data, err.message || 'Không th? kết nối server d? kiểm tra trạng thái hệ thống.'));
    } finally {
      setCheckingSetup(false);
    }
  }, []);

  useEffect(() => {
    if (bootstrapStatus) {
      applyBootstrapStatus(bootstrapStatus);
      setCheckingSetup(false);
      return;
    }
    checkBootstrapStatus();
  }, [bootstrapStatus, checkBootstrapStatus]);

  const validateForm = () => {
    if (checkingSetup) {
      setError('đang kiểm tra trạng thái hệ thống, vui l?ng dài trong gi?y l?t.');
      return false;
    }

    if (!form.name.trim()) {
      setError('Vui lượng nhập h? v? t?n.');
      return false;
    }

    if (form.name.trim().length < 2) {
      setError('H? v? t?n ph?i c? ?t nh?t 2 k? t?.');
      return false;
    }

    if (!form.email.trim()) {
      setError('Vui lượng nhập email.');
      return false;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      setError('Email không hợp l?.');
      return false;
    }

    if (!form.phone.trim()) {
      setError('Vui lượng nhập s? điện thoại.');
      return false;
    }

    if (!/^0\d{9,10}$/.test(normalizePhone(form.phone))) {
      setError('S? điện thoại ph?i bắt đầu bằng 0 v? g?m 10-11 ch? s?.');
      return false;
    }

    if (!form.password) {
      setError('Vui lượng nhập mật khẩu.');
      return false;
    }

    if (form.password.length < 8) {
      setError('Mật khẩu ph?i c? ?t nh?t 8 k? t?.');
      return false;
    }

    if (!form.confirmPassword) {
      setError('Vui lượng nhập xác nhận mật khẩu.');
      return false;
    }

    if (form.password !== form.confirmPassword) {
      setError('Mật khẩu xác nhận không kh?p.');
      return false;
    }

    return true;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setSuccess('');

    if (!validateForm()) return;

    const payload = {
      name: form.name.trim(),
      email: normalizeEmail(form.email),
      phone: form.phone.trim(),
      password: form.password,
    };

    setLoading(true);
    try {
      const data = await authApi.register(payload);
      setSuccess('Tạo tài khoản thành công');
      setRegisteredData(data);
    } catch (err) {
      setError(getApiErrorMessage(err?.data, err.message || 'Không th? kết nối server d? dang k? tài khoản.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-gray-900 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
        <div className="text-center mb-6">
          <div className={`w-14 h-14 ${registeredData ? 'bg-green-100' : 'bg-blue-100'} rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-lg`}>
            {registeredData ? (
              <CheckCircle className="text-green-600" size={28} />
            ) : isFirstAccount ? (
              <ShieldCheck className="text-amber-600" size={28} />
            ) : (
              <UserPlus className="text-blue-600" size={28} />
            )}
          </div>
          <h1 className="text-xl font-bold text-gray-800">{pageContent.title}</h1>
          <p className="text-gray-500 text-sm mt-1">{pageContent.description}</p>
        </div>

        {success && (
          <div className="mb-4 flex items-start gap-2 bg-green-50 border border-green-200 text-green-700 rounded-xl px-4 py-3 text-sm">
            <CheckCircle size={18} className="shrink-0 mt-0.5" />
            <div className="font-semibold">{success}</div>
          </div>
        )}

        {error && (
          <div className="mb-4 flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
            <XCircle size={18} className="shrink-0 mt-0.5" />
            <div className="flex-1">{error}</div>
            <button
              type="button"
              onClick={checkBootstrapStatus}
              disabled={checkingSetup || loading}
              className="text-xs font-semibold text-red-700 underline decoration-red-300 hover:text-red-900 disabled:text-red-300 disabled:cursor-not-allowed"
            >
              Th? lỗi
            </button>
          </div>
        )}

        {checkingSetup && (
          <div className="text-center py-8 text-gray-500 text-sm">
            <RefreshCw className="animate-spin mx-auto mb-3 text-blue-600" size={28} />
            đang kiểm tra trạng thái dang k?...
          </div>
        )}

        {registeredData ? (
          <div className="space-y-6 text-center py-4">
            <div className="text-gray-600 text-base font-medium">
              Bản c? mu?n đăng nhập tự động bằng tài khoản v?a tạo hay quay v? trang đăng nhập?
            </div>
            
            <div className="space-y-3">
              <button
                type="button"
                onClick={async () => {
                  try {
                    setLoading(true);
                    await completeLogin(registeredData);
                  } catch (err) {
                    setError(err.message || 'Không th? tự động đăng nhập.');
                    setRegisteredData(null);
                  } finally {
                    setLoading(false);
                  }
                }}
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white py-3 rounded-xl font-bold text-lg transition flex items-center justify-center gap-2"
              >
                {loading ? <RefreshCw size={20} className="animate-spin" /> : null}
                Tự động đăng nhập
              </button>
              
              <button
                type="button"
                onClick={() => navigate('/')}
                disabled={loading}
                className="w-full border border-gray-300 hover:bg-gray-50 text-gray-700 py-3 rounded-xl font-bold text-lg transition flex items-center justify-center gap-2"
              >
                Chuy?n t?i đang Nhập
              </button>
            </div>
          </div>
        ) : !checkingSetup && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                <span className="inline-flex items-center gap-1"><User size={14} /> H? v? t?n <span className="text-red-500">*</span></span>
              </label>
              <input
                type="text"
                value={form.name}
                onChange={event => set('name', event.target.value)}
                placeholder="vankhadev07"
                className="input-field w-full pl-4"
                autoComplete="name"
                disabled={submitDisabled}
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                <span className="inline-flex items-center gap-1"><Mail size={14} /> Email <span className="text-red-500">*</span></span>
              </label>
              <input
                type="email"
                value={form.email}
                onChange={event => set('email', event.target.value)}
                placeholder="vankhaqc@gmail.com"
                className="input-field w-full pl-4"
                autoComplete="email"
                disabled={submitDisabled}
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                <span className="inline-flex items-center gap-1"><Phone size={14} /> S? điện thoại <span className="text-red-500">*</span></span>
              </label>
              <input
                type="tel"
                value={form.phone}
                onChange={event => set('phone', event.target.value)}
                placeholder="0904 045 075"
                className="input-field w-full pl-4"
                autoComplete="tel"
                disabled={submitDisabled}
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
                  placeholder="Vui Lượng Nhập Một Khẩu"
                  className="input-field w-full pl-4 pr-10"
                  autoComplete="new-password"
                  disabled={submitDisabled}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPass(current => !current)}
                  disabled={submitDisabled}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 disabled:text-gray-300 disabled:cursor-not-allowed"
                  aria-label={showPass ? '?n mật khẩu' : 'Hiện mật khẩu'}
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
                  placeholder="Nhập Một Khẩu X?c Nhân"
                  className="input-field w-full pl-4 pr-10"
                  autoComplete="new-password"
                  disabled={submitDisabled}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm(current => !current)}
                  disabled={submitDisabled}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 disabled:text-gray-300 disabled:cursor-not-allowed"
                  aria-label={showConfirm ? '?n xác nhận mật khẩu' : 'Hiện xác nhận mật khẩu'}
                >
                  {showConfirm ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitDisabled}
              className={`${isFirstAccount ? 'bg-amber-600 hover:bg-amber-700' : 'bg-blue-600 hover:bg-blue-700'} w-full disabled:bg-gray-300 disabled:cursor-not-allowed text-white py-3 rounded-xl font-bold text-lg transition flex items-center justify-center gap-2`}
            >
              {loading ? (
                <><RefreshCw size={20} className="animate-spin" /> đang dang k?...</>
              ) : isFirstAccount ? (
                <><ShieldCheck size={20} /> đang k?</>
              ) : (
                <><UserPlus size={20} /> đang k?</>
              )}
            </button>
          </form>
        )}

        {!registeredData && (
          <div className="mt-4 text-center">
            <Link to="/" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 font-medium">
              <ArrowLeft size={14} /> ?? c? tài khoản? đang nh?p
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
