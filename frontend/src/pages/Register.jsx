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
  name: '',
  email: '',
  phone: '',
  password: '',
  confirmPassword: '',
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
  const [currentBootstrapStatus, setCurrentBootstrapStatus] = useState({
    totalUsers: 0,
    hasAdmin: false,
    nextRole: 'ADMIN',
    message: 'Tài khoản đầu tiên sẽ được cấp quyền ADMIN',
  });

  const nextRole = String(currentBootstrapStatus.nextRole || (currentBootstrapStatus.needsSetup ? 'ADMIN' : 'USER')).toUpperCase();
  const isFirstAccount = nextRole === 'ADMIN' || !!currentBootstrapStatus.needsSetup;
  const submitDisabled = loading || checkingSetup;

  const pageContent = useMemo(() => {
    if (checkingSetup) {
      return {
        title: 'Đang kiểm tra hệ thống',
        description: 'Vui lòng đợi trong giây lát trước khi đăng ký tài khoản',
      };
    }

    if (isFirstAccount) {
      return {
        title: 'Đăng ký tài khoản đầu tiên',
        description: 'Tài khoản đầu tiên sẽ được server tự động cấp quyền ADMIN',
      };
    }

    return {
      title: 'Đăng ký tài khoản người dùng',
      description: 'Hệ thống đã có tài khoản, tài khoản mới sẽ là USER',
    };
  }, [checkingSetup, isFirstAccount]);

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
      message: data?.message || (data?.needsSetup ? 'Tài khoản đầu tiên sẽ được cấp quyền ADMIN' : 'Tài khoản đăng ký tiếp theo sẽ là USER'),
    });
  };

  const completeLogin = async (payload) => {
    if (!payload?.token || !payload?.user) {
      throw new Error('Server không trả đủ thông tin đăng nhập.');
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
      setError(getApiErrorMessage(err?.data, err.message || 'Không thể kết nối server để kiểm tra trạng thái hệ thống.'));
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
      setError('Đang kiểm tra trạng thái hệ thống, vui lòng đợi trong giây lát.');
      return false;
    }

    if (!form.name.trim()) {
      setError('Vui lòng nhập họ và tên.');
      return false;
    }

    if (form.name.trim().length < 2) {
      setError('Họ và tên phải có ít nhất 2 ký tự.');
      return false;
    }

    if (!form.email.trim()) {
      setError('Vui lòng nhập email.');
      return false;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      setError('Email không hợp lệ.');
      return false;
    }

    if (!form.phone.trim()) {
      setError('Vui lòng nhập số điện thoại.');
      return false;
    }

    if (!/^0\d{9,10}$/.test(normalizePhone(form.phone))) {
      setError('Số điện thoại phải bắt đầu bằng 0 và gồm 10-11 chữ số.');
      return false;
    }

    if (!form.password) {
      setError('Vui lòng nhập mật khẩu.');
      return false;
    }

    if (form.password.length < 6) {
      setError('Mật khẩu phải có ít nhất 6 ký tự.');
      return false;
    }

    if (!form.confirmPassword) {
      setError('Vui lòng nhập xác nhận mật khẩu.');
      return false;
    }

    if (form.password !== form.confirmPassword) {
      setError('Mật khẩu xác nhận không khớp.');
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
      const apiMessage = data.message || (String(data.user?.role || data.role).toLowerCase() === 'admin'
        ? 'Tài khoản đầu tiên đã được cấp quyền ADMIN'
        : 'Đăng ký thành công với quyền USER');
      setSuccess(`${apiMessage}. Đang khôi phục phiên từ server...`);
      await completeLogin(data);
    } catch (err) {
      setError(getApiErrorMessage(err?.data, err.message || 'Không thể kết nối server để đăng ký tài khoản.'));
      await checkBootstrapStatus();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-gray-900 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
        <div className="text-center mb-6">
          <div className="w-14 h-14 bg-blue-100 rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-lg">
            {isFirstAccount ? <ShieldCheck className="text-amber-600" size={28} /> : <UserPlus className="text-blue-600" size={28} />}
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
              Thử lại
            </button>
          </div>
        )}

        {checkingSetup && (
          <div className="text-center py-8 text-gray-500 text-sm">
            <RefreshCw className="animate-spin mx-auto mb-3 text-blue-600" size={28} />
            Đang kiểm tra trạng thái đăng ký...
          </div>
        )}

        {!checkingSetup && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className={`${isFirstAccount ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-blue-50 border-blue-200 text-blue-700'} border rounded-xl px-4 py-3 text-sm flex items-start gap-2`}>
              <Info size={18} className="shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold">Server tự quyết định quyền tài khoản.</div>
                <div>
                  {isFirstAccount
                    ? 'Database chưa có user nào: tài khoản này sẽ được cấp quyền ADMIN.'
                    : 'Hệ thống đã có user/admin: tài khoản đăng ký mới sẽ mặc định là USER.'}
                </div>
                <div className="mt-1 text-xs opacity-80">Form đăng ký không gửi và không cho chọn role từ client.</div>
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
                placeholder="nguyenvana@cuahang.com"
                className="input-field w-full pl-4"
                autoComplete="email"
                disabled={submitDisabled}
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
                  placeholder="Tối thiểu 6 ký tự"
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
                  disabled={submitDisabled}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm(current => !current)}
                  disabled={submitDisabled}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 disabled:text-gray-300 disabled:cursor-not-allowed"
                  aria-label={showConfirm ? 'Ẩn xác nhận mật khẩu' : 'Hiện xác nhận mật khẩu'}
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
                <><RefreshCw size={20} className="animate-spin" /> Đang đăng ký...</>
              ) : isFirstAccount ? (
                <><ShieldCheck size={20} /> Đăng ký ADMIN đầu tiên</>
              ) : (
                <><UserPlus size={20} /> Đăng ký USER</>
              )}
            </button>
          </form>
        )}

        <div className="mt-4 text-center">
          <Link to="/" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 font-medium">
            <ArrowLeft size={14} /> Quay lại đăng nhập
          </Link>
        </div>

        <div className="mt-4 bg-gray-50 rounded-xl p-4 text-xs text-gray-600">
          <div className="font-semibold mb-1">📌 Trạng thái quyền đăng ký:</div>
          {checkingSetup ? (
            <div>Đang tải trạng thái từ server...</div>
          ) : (
            <div className="space-y-1">
              <div>{currentBootstrapStatus.message}</div>
              <div>Tổng user hiện có: {currentBootstrapStatus.totalUsers}. Đã có admin: {currentBootstrapStatus.hasAdmin ? 'Có' : 'Chưa'}.</div>
              <div>Quyền dự kiến cho tài khoản mới: <span className="font-bold">{nextRole}</span>.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
