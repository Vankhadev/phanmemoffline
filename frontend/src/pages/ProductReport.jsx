import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { resolveApiUrl } from '../utils/apiClient';
import { globalSyncEmitter } from '../utils/eventEmitter';
import {
  BarChart3,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Download,
  DollarSign,
  FilePlus,
  FileText,
  Loader,
  Package,
  RefreshCw,
  Search,
  ShoppingCart,
  X,
} from 'lucide-react';

const API = resolveApiUrl('');

function pad2(value) {
  return String(value).padStart(2, '0');
}

function isValidDateObject(date) {
  return date instanceof Date && !Number.isNaN(date.getTime());
}

function createLocalDate(year, month, day) {
  if (![year, month, day].every(Number.isInteger)) return null;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

function toDateInputValue(date) {
  if (!isValidDateObject(date)) return '';
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function getMonthInputValue(date) {
  if (!isValidDateObject(date)) return '';
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}

function normalizeDateInputValue(value) {
  if (value instanceof Date) return toDateInputValue(value);

  const rawValue = String(value ?? '').trim();
  let match = rawValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const [, yearText, monthText, dayText] = match;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    return createLocalDate(year, month, day) ? `${yearText}-${monthText}-${dayText}` : '';
  }

  match = rawValue.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    const [, dayText, monthText, yearText] = match;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    return createLocalDate(year, month, day) ? `${yearText}-${pad2(month)}-${pad2(day)}` : '';
  }

  return '';
}

function hasDateValue(value) {
  if (value instanceof Date) return true;
  return String(value ?? '').trim() !== '';
}

function parseDateInputValue(value) {
  const normalizedValue = normalizeDateInputValue(value);
  if (!normalizedValue) return null;
  const [year, month, day] = normalizedValue.split('-').map(Number);
  return createLocalDate(year, month, day);
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function isValidDateInputValue(value) {
  return Boolean(normalizeDateInputValue(value));
}

function getDefaultFilters() {
  const now = new Date();
  return {
    period: 'month',
    selectedDate: toDateInputValue(now),
    selectedMonth: getMonthInputValue(now),
    selectedYear: String(now.getFullYear()),
    from: toDateInputValue(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: toDateInputValue(now),
    status: 'completed',
  };
}

function monthRange(monthValue) {
  if (!/^\d{4}-\d{2}$/.test(String(monthValue || ''))) return null;
  const [year, month] = String(monthValue).split('-').map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  return {
    from: `${year}-${pad2(month)}-01`,
    to: `${year}-${pad2(month)}-${pad2(daysInMonth(year, month))}`,
  };
}

function yearRange(yearValue) {
  const year = Number(yearValue);
  if (!Number.isInteger(year) || year < 1900 || year > 9999) return null;
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

function getPeriodRange({ period, selectedDate, selectedMonth, selectedYear, from, to }) {
  if (period === 'day') {
    const normalizedSelectedDate = normalizeDateInputValue(selectedDate);
    if (!normalizedSelectedDate) return { valid: false, message: 'Vui l?ng ch?n ng?y h?p l?.' };
    return { valid: true, from: normalizedSelectedDate, to: normalizedSelectedDate };
  }

  if (period === 'month') {
    const range = monthRange(selectedMonth);
    if (!range) return { valid: false, message: 'Vui l?ng ch?n th?ng h?p l?.' };
    return { valid: true, ...range };
  }

  if (period === 'year') {
    const range = yearRange(selectedYear);
    if (!range) return { valid: false, message: 'Vui l?ng nh?p nam h?p l?.' };
    return { valid: true, ...range };
  }

  const normalizedFrom = normalizeDateInputValue(from);
  const normalizedTo = normalizeDateInputValue(to);
  if (!hasDateValue(from)) return { valid: false, message: 'Vui l?ng ch?n ng?y b?t d?u.' };
  if (!hasDateValue(to)) return { valid: false, message: 'Vui l?ng ch?n ng?y k?t th?c.' };
  if (!normalizedFrom) return { valid: false, message: 'Ng?y b?t d?u kh?ng h?p l?.' };
  if (!normalizedTo) return { valid: false, message: 'Ng?y k?t th?c kh?ng h?p l?.' };
  if (normalizedFrom > normalizedTo) return { valid: false, message: 'Ng?y b?t d?u kh?ng du?c l?n hon ng?y k?t th?c.' };
  return { valid: true, from: normalizedFrom, to: normalizedTo };
}

function formatVND(value) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(Number(value) || 0);
}

function formatNumber(value) {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(Number(value) || 0);
}

function formatDateKey(value) {
  if (!value) return '?';
  const normalizedValue = normalizeDateInputValue(value);
  if (!normalizedValue) return String(value);
  const [year, month, day] = normalizedValue.split('-');
  return `${day}/${month}/${year}`;
}

function formatDateTime(value) {
  if (!value) return '?';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function safeSheetName(name) {
  const normalized = String(name || 'Bao cao').replace(/[\\/?*\[\]:]/g, ' ').trim();
  return (normalized || 'Bao cao').slice(0, 31);
}

function safeFilePart(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '') || 'bao-cao';
}

const PERIOD_OPTIONS = [
  { value: 'day', label: 'Theo ng?y' },
  { value: 'month', label: 'Theo th?ng' },
  { value: 'year', label: 'Theo nam' },
  { value: 'custom', label: 'Kho?ng ng?y t?y ch?nh' },
];

const STATUS_OPTIONS = [
  { value: 'completed', label: '?on ho?n th?nh' },
  { value: 'exclude_cancelled', label: 'T?t c? tr? don h?y' },
];

function buildProductReportRequest(filters) {
  const range = getPeriodRange(filters);
  if (!range.valid) return { valid: false, message: range.message };

  const params = new URLSearchParams({
    period: filters.period,
    from: range.from,
    to: range.to,
    status: filters.status || 'completed',
  });

  if (filters.period === 'day') params.set('date', range.from);
  if (filters.period === 'month') params.set('month', filters.selectedMonth);
  if (filters.period === 'year') params.set('year', filters.selectedYear);

  return { valid: true, range, params };
}

function getPeriodDescription(filters, range) {
  if (filters.period === 'day') return `theo ng?y ${formatDateKey(range.from)}`;

  if (filters.period === 'month') {
    const [year, month] = String(filters.selectedMonth || '').split('-');
    if (year && month) return `theo th?ng ${month}/${year}`;
    return `theo th?ng ${formatDateKey(range.from)} - ${formatDateKey(range.to)}`;
  }

  if (filters.period === 'year') return `theo nam ${filters.selectedYear}`;

  return `theo kho?ng ng?y t? ${formatDateKey(range.from)} d?n ${formatDateKey(range.to)}`;
}

function getStatusLabel(status) {
  return STATUS_OPTIONS.find(option => option.value === status)?.label || status;
}

const WEEKDAY_LABELS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

function getCalendarDays(viewDate) {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDayOfMonth = new Date(year, month, 1);
  const leadingBlankDays = (firstDayOfMonth.getDay() + 6) % 7;
  const totalDays = daysInMonth(year, month + 1);
  const calendarDays = [];

  for (let index = 0; index < leadingBlankDays; index += 1) {
    calendarDays.push(null);
  }

  for (let day = 1; day <= totalDays; day += 1) {
    calendarDays.push(new Date(year, month, day));
  }

  while (calendarDays.length % 7 !== 0) {
    calendarDays.push(null);
  }

  return calendarDays;
}

function DatePickerField({
  value,
  onChange,
  disabled = false,
  placeholder = 'Ch?n ng?y',
  ariaLabel = 'Ch?n ng?y',
  minDate = '',
  maxDate = '',
}) {
  const wrapperRef = useRef(null);
  const normalizedValue = normalizeDateInputValue(value);
  const normalizedMinDate = normalizeDateInputValue(minDate);
  const normalizedMaxDate = normalizeDateInputValue(maxDate);
  const parsedValue = parseDateInputValue(normalizedValue);
  const [isOpen, setIsOpen] = useState(false);
  const [viewDate, setViewDate] = useState(() => startOfMonth(parsedValue || parseDateInputValue(normalizedMinDate) || new Date()));

  useEffect(() => {
    const selectedDate = parseDateInputValue(normalizedValue);
    const minSelectableDate = parseDateInputValue(normalizedMinDate);
    if (!isOpen) {
      if (selectedDate) {
        setViewDate(startOfMonth(selectedDate));
      } else if (minSelectableDate) {
        setViewDate(startOfMonth(minSelectableDate));
      }
    }
  }, [isOpen, normalizedMaxDate, normalizedMinDate, normalizedValue]);

  useEffect(() => {
    if (!isOpen) return undefined;

    function handlePointerDown(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
    };
  }, [isOpen]);

  const calendarDays = useMemo(() => getCalendarDays(viewDate), [viewDate]);
  const selectedValue = normalizedValue;
  const todayValue = toDateInputValue(new Date());
  const displayText = selectedValue ? formatDateKey(selectedValue) : placeholder;
  const monthLabel = viewDate.toLocaleDateString('vi-VN', { month: 'long', year: 'numeric' });

  function isDateDisabled(date) {
    const dayValue = normalizeDateInputValue(date);
    if (!dayValue) return true;
    if (normalizedMinDate && dayValue < normalizedMinDate) return true;
    if (normalizedMaxDate && dayValue > normalizedMaxDate) return true;
    return false;
  }

  function changeMonth(offset) {
    setViewDate(prev => new Date(prev.getFullYear(), prev.getMonth() + offset, 1));
  }

  function selectDate(date) {
    const normalizedDate = normalizeDateInputValue(date);
    if (!normalizedDate || isDateDisabled(normalizedDate)) return;
    onChange(normalizedDate);
    setIsOpen(false);
  }

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        className={`input-field flex min-h-[44px] items-center gap-2 rounded-xl border-gray-200 px-3 text-left text-sm transition ${disabled ? 'cursor-not-allowed bg-gray-100 text-gray-400' : 'bg-white text-gray-700 hover:border-blue-400 hover:bg-blue-50/30'}`}
        onClick={() => !disabled && setIsOpen(prev => !prev)}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
      >
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${disabled ? 'bg-gray-200 text-gray-300' : 'bg-blue-50 text-blue-600'}`}>
          <Calendar size={16} />
        </span>
        <span className={`flex-1 truncate ${selectedValue ? 'font-semibold' : 'text-gray-400'}`}>{displayText}</span>
      </button>

      {isOpen && !disabled && (
        <div className="absolute left-0 top-full z-[60] mt-2 w-full min-w-[17.5rem] max-w-[calc(100vw-2rem)] rounded-2xl border border-gray-200 bg-white p-3 shadow-2xl">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              className="rounded-xl border border-gray-200 p-2 text-gray-500 transition hover:bg-gray-50 hover:text-gray-800"
              onClick={() => changeMonth(-1)}
              aria-label="Th?ng tru?c"
            >
              <ChevronLeft size={16} />
            </button>
            <div className="text-sm font-bold capitalize text-gray-800">{monthLabel}</div>
            <button
              type="button"
              className="rounded-xl border border-gray-200 p-2 text-gray-500 transition hover:bg-gray-50 hover:text-gray-800"
              onClick={() => changeMonth(1)}
              aria-label="Th?ng sau"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[11px] font-bold uppercase tracking-wide text-gray-400">
            {WEEKDAY_LABELS.map(label => (
              <div key={label} className="py-1">{label}</div>
            ))}
          </div>

          <div className="mt-1 grid grid-cols-7 gap-1">
            {calendarDays.map((day, index) => {
              if (!day) return <div key={`empty-${index}`} className="aspect-square" />;

              const dayValue = toDateInputValue(day);
              const isSelected = dayValue === selectedValue;
              const isToday = dayValue === todayValue;
              const isDisabled = isDateDisabled(dayValue);

              return (
                <button
                  key={dayValue}
                  type="button"
                  className={`aspect-square rounded-xl text-sm font-semibold transition ${isDisabled ? 'cursor-not-allowed bg-gray-50 text-gray-300' : isSelected ? 'bg-blue-600 text-white shadow-sm hover:bg-blue-700' : isToday ? 'border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100' : 'text-gray-700 hover:bg-gray-100'}`}
                  onClick={() => selectDate(day)}
                  aria-pressed={isSelected}
                  aria-label={`Ch?n ng?y ${formatDateKey(dayValue)}`}
                  disabled={isDisabled}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-3 text-xs font-semibold">
            <button
              type="button"
              className="rounded-lg px-2 py-1.5 text-blue-600 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:bg-transparent"
              onClick={() => selectDate(new Date())}
              disabled={isDateDisabled(todayValue)}
            >
              H?m nay
            </button>
            <button
              type="button"
              className="rounded-lg px-2 py-1.5 text-gray-500 transition hover:bg-gray-100"
              onClick={() => setIsOpen(false)}
            >
              ??ng
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function DateRangePopover({ from, to, label, onApply, disabled = false }) {
  const wrapperRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(from || '');
  const [draftTo, setDraftTo] = useState(to || '');
  const [draftError, setDraftError] = useState('');
  const [isApplying, setIsApplying] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setDraftFrom(normalizeDateInputValue(from) || '');
    setDraftTo(normalizeDateInputValue(to) || '');
    setDraftError('');
  }, [from, isOpen, to]);

  useEffect(() => {
    if (!isOpen) return undefined;

    function handlePointerDown(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
    };
  }, [isOpen]);

  function updateDraftFrom(value) {
    setDraftFrom(normalizeDateInputValue(value));
    if (draftError) setDraftError('');
  }

  function updateDraftTo(value) {
    setDraftTo(normalizeDateInputValue(value));
    if (draftError) setDraftError('');
  }

  async function applyDateRange() {
    const range = getPeriodRange({ period: 'custom', from: draftFrom, to: draftTo });
    if (!range.valid) {
      setDraftError(range.message);
      return;
    }

    setDraftError('');
    setIsApplying(true);
    try {
      const applied = await onApply({ from: range.from, to: range.to });
      if (applied !== false) setIsOpen(false);
    } catch (err) {
      setDraftError(err.message || 'Không áp dụng được khoảng ngày.');
    } finally {
      setIsApplying(false);
    }
  }

  const normalizedFrom = normalizeDateInputValue(from);
  const normalizedTo = normalizeDateInputValue(to);
  const fromText = normalizedFrom ? formatDateKey(normalizedFrom) : 'Chọn ngày';
  const toText = normalizedTo ? formatDateKey(normalizedTo) : 'Chọn ngày';
  const draftFromText = draftFrom ? (normalizeDateInputValue(draftFrom) ? formatDateKey(draftFrom) : 'Không hợp lệ') : '?';
  const draftToText = draftTo ? (normalizeDateInputValue(draftTo) ? formatDateKey(draftTo) : 'Không hợp lệ') : '?';
  const isRangeValid = Boolean(normalizedFrom && normalizedTo && normalizedFrom <= normalizedTo);
  const rangeStatusText = isRangeValid ? `Từ ${fromText} đến ${toText}` : label;
  const normalizedDraftFrom = normalizeDateInputValue(draftFrom);
  const normalizedDraftTo = normalizeDateInputValue(draftTo);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        className={`w-full rounded-2xl border p-3 text-left text-sm transition ${disabled ? 'cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400' : 'border-gray-200 bg-white text-gray-700 shadow-sm hover:border-blue-400 hover:bg-blue-50/40'}`}
        onClick={() => !disabled && setIsOpen(prev => !prev)}
        disabled={disabled}
        aria-label="Chọn khoảng ngày báo cáo"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
      >
        <div className="flex items-center justify-between gap-2">
          <span className={`inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wide ${disabled ? 'text-gray-400' : 'text-blue-700'}`}>
            <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${disabled ? 'bg-gray-200 text-gray-300' : 'bg-blue-50 text-blue-600'}`}>
              <Calendar size={15} />
            </span>
            Chọn khoảng
          </span>
          <span className={`rounded-lg px-2 py-1 text-xs font-bold ${disabled ? 'bg-gray-200 text-gray-400' : 'bg-blue-50 text-blue-600'}`}>
            Chọn
          </span>
        </div>

        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className={`rounded-xl border px-3 py-2 ${disabled ? 'border-gray-200 bg-gray-50' : 'border-blue-100 bg-blue-50/70'}`}>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Từ ngày</div>
            <div className={`mt-0.5 whitespace-nowrap text-sm font-bold ${from && isValidDateInputValue(from) ? 'text-gray-900' : 'text-gray-400'}`}>{fromText}</div>
          </div>
          <div className={`rounded-xl border px-3 py-2 ${disabled ? 'border-gray-200 bg-gray-50' : 'border-blue-100 bg-blue-50/70'}`}>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Đến ngày</div>
            <div className={`mt-0.5 whitespace-nowrap text-sm font-bold ${to && isValidDateInputValue(to) ? 'text-gray-900' : 'text-gray-400'}`}>{toText}</div>
          </div>
        </div>

        <div className={`mt-2 text-xs font-medium ${isRangeValid ? 'text-gray-500' : 'text-red-600'}`}>
          {rangeStatusText}
        </div>
      </button>

      {isOpen && !disabled && (
        <div className="absolute left-0 top-full z-[70] mt-2 max-w-[calc(100vw-2rem)] rounded-2xl border border-gray-200 bg-white p-4 shadow-2xl" style={{ width: 'min(34rem, calc(100vw - 2rem))' }}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-bold text-gray-800">
                <Calendar size={16} className="text-blue-600" />
                Chọn khoảng ngày
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Chọn ngày bắt đầu và ngày kết thúc, sau đó nhấn Áp dụng để chạy báo cáo theo khoảng tùy chỉnh.
              </p>
            </div>
            <button
              type="button"
              className="rounded-xl border border-gray-200 p-2 text-gray-400 transition hover:bg-gray-50 hover:text-gray-700"
              onClick={() => setIsOpen(false)}
              aria-label="Đóng chọn khoảng ngày"
            >
              <X size={16} />
            </button>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-gray-600">Từ ngày</label>
              <DatePickerField
                value={draftFrom}
                onChange={updateDraftFrom}
                ariaLabel="Chọn từ ngày của khoảng ngày"
                maxDate={normalizedDraftTo}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-gray-600">Đến ngày</label>
              <DatePickerField
                value={draftTo}
                onChange={updateDraftTo}
                ariaLabel="Chọn đến ngày của khoảng ngày"
                minDate={normalizedDraftFrom}
              />
            </div>
          </div>

          <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700">
            Đang chọn: Từ {draftFromText} đến {draftToText}
          </div>

          {draftError && (
            <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
              {draftError}
            </div>
          )}

          <div className="mt-4 flex flex-col-reverse gap-2 border-t border-gray-100 pt-4 sm:flex-row sm:justify-end">
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => setIsOpen(false)}
              disabled={isApplying}
            >
              Hủy
            </button>
            <button
              type="button"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
              onClick={applyDateRange}
              disabled={isApplying}
            >
              {isApplying ? <Loader size={16} className="animate-spin" /> : <Search size={16} />}
              Áp dụng
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function DateRangeInlinePicker({
  from,
  to,
  label,
  onFromChange,
  onToChange,
  onApply,
  disabled = false,
}) {
  const [isApplying, setIsApplying] = useState(false);
  const normalizedFrom = normalizeDateInputValue(from);
  const normalizedTo = normalizeDateInputValue(to);
  const hasInvalidRange = Boolean(normalizedFrom && normalizedTo && normalizedFrom > normalizedTo);
  const helperText = hasInvalidRange
    ? 'Ng?y b?t d?u kh?ng du?c l?n hon ng?y k?t th?c.'
    : label;
  const canApply = !disabled && !isApplying && Boolean(normalizedFrom && normalizedTo && !hasInvalidRange);

  async function handleApply() {
    if (!canApply) return;
    setIsApplying(true);
    try {
      await onApply({ from: normalizedFrom, to: normalizedTo });
    } finally {
      setIsApplying(false);
    }
  }

  return (
    <div className={`rounded-2xl border p-3 shadow-sm ${disabled ? 'border-gray-200 bg-gray-100 text-gray-400' : 'border-blue-100 bg-white text-gray-700'}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-blue-700">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
            <Calendar size={15} />
          </span>
          Ch?n kho?ng ng?y b?o c?o
        </div>
        <button
          type="button"
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
          onClick={handleApply}
          disabled={!canApply}
        >
          {isApplying ? <Loader size={16} className="animate-spin" /> : <Search size={16} />}
          ?p d?ng
        </button>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-semibold text-gray-600">T? ng?y</label>
          <DatePickerField
            value={from}
            onChange={onFromChange}
            disabled={disabled || isApplying}
            ariaLabel="Ch?n t? ng?y c?a b?o c?o s?n ph?m"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-gray-600">??n ng?y</label>
          <DatePickerField
            value={to}
            onChange={onToChange}
            disabled={disabled || isApplying}
            ariaLabel="Ch?n d?n ng?y c?a b?o c?o s?n ph?m"
          />
        </div>
      </div>

      <div className={`mt-2 text-xs font-medium ${hasInvalidRange ? 'text-red-600' : 'text-gray-500'}`}>
        {helperText}
      </div>
    </div>
  );
}

export default function ProductReport() {
  const defaultFilters = useMemo(() => getDefaultFilters(), []);
  const [period, setPeriod] = useState(defaultFilters.period);
  const [selectedDate, setSelectedDate] = useState(defaultFilters.selectedDate);
  const [selectedMonth, setSelectedMonth] = useState(defaultFilters.selectedMonth);
  const [selectedYear, setSelectedYear] = useState(defaultFilters.selectedYear);
  const [from, setFrom] = useState(defaultFilters.from);
  const [to, setTo] = useState(defaultFilters.to);
  const [status, setStatus] = useState(defaultFilters.status);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [lastFetchedAt, setLastFetchedAt] = useState(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [reportDraft, setReportDraft] = useState(() => ({ ...defaultFilters }));
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState('');
  const [createdNotice, setCreatedNotice] = useState('');
  const [showHelp, setShowHelp] = useState(false);

  const selectedRange = useMemo(() => getPeriodRange({
    period,
    selectedDate,
    selectedMonth,
    selectedYear,
    from,
    to,
  }), [from, period, selectedDate, selectedMonth, selectedYear, to]);

  const createRange = useMemo(() => getPeriodRange(reportDraft), [reportDraft]);
  const rows = report?.rows || [];
  const summary = report?.summary || {};
  const canFetch = selectedRange.valid && !loading;
  const canExport = rows.length > 0 && !loading;

  const fetchReport = useCallback(async (filtersOverride = null) => {
    const filters = filtersOverride || { period, selectedDate, selectedMonth, selectedYear, from, to, status };
    const request = buildProductReportRequest(filters);
    if (!request.valid) {
      setError(request.message);
      return false;
    }

    setLoading(true);
    setError('');
    setCreatedNotice('');
    try {
      const endpoint = `${API}/stats/product-report?${request.params.toString()}`;
      console.info('[ProductReport] fetchReport -> requesting', {
        endpoint,
        filters,
        range: request.range,
      });
      const res = await fetch(endpoint);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Kh?ng l?p du?c b?o c?o s?n ph?m');
      setReport(data);
      setLastFetchedAt(new Date());
      return true;
    } catch (err) {
      setReport(null);
      setError(err.message || 'Kh?ng l?p du?c b?o c?o s?n ph?m');
      return false;
    } finally {
      setLoading(false);
    }
  }, [period, selectedDate, selectedMonth, selectedYear, from, to, status]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  useEffect(() => {
    const handleSyncRefresh = () => {
      fetchReport();
      console.log('[SYNC] ProductReport refreshed');
    };

    const unsubProductUpdated = globalSyncEmitter.on('PRODUCT_UPDATED', handleSyncRefresh);
    const unsubProductImported = globalSyncEmitter.on('PRODUCT_IMPORTED', handleSyncRefresh);
    const unsubOrderCreated = globalSyncEmitter.on('ORDER_CREATED', handleSyncRefresh);
    const unsubOrderUpdated = globalSyncEmitter.on('ORDER_UPDATED', handleSyncRefresh);
    const unsubOrderDeleted = globalSyncEmitter.on('ORDER_DELETED', handleSyncRefresh);

    return () => {
      unsubProductUpdated();
      unsubProductImported();
      unsubOrderCreated();
      unsubOrderUpdated();
      unsubOrderDeleted();
    };
  }, [fetchReport]);

  function getActiveFilters() {
    return { period, selectedDate, selectedMonth, selectedYear, from, to, status };
  }

  function applyFiltersToPage(filters) {
    setPeriod(filters.period || defaultFilters.period);
    setSelectedDate(normalizeDateInputValue(filters.selectedDate) || defaultFilters.selectedDate);
    setSelectedMonth(filters.selectedMonth || defaultFilters.selectedMonth);
    setSelectedYear(filters.selectedYear || defaultFilters.selectedYear);
    setFrom(normalizeDateInputValue(filters.from) || defaultFilters.from);
    setTo(normalizeDateInputValue(filters.to) || defaultFilters.to);
    setStatus(filters.status || defaultFilters.status);
  }

  function updateReportDraft(field, value) {
    const normalizedValue = ['selectedDate', 'from', 'to'].includes(field)
      ? normalizeDateInputValue(value)
      : value;
    setReportDraft(prev => ({ ...prev, [field]: normalizedValue }));
    if (createError) setCreateError('');
  }

  async function applyQuickDateRange({ from: nextFrom, to: nextTo }) {
    const nextFilters = {
      ...getActiveFilters(),
      period: 'custom',
      from: nextFrom,
      to: nextTo,
    };
    const request = buildProductReportRequest(nextFilters);
    if (!request.valid) {
      setError(request.message);
      return false;
    }

    applyFiltersToPage(nextFilters);
    return fetchReport(nextFilters);
  }

  function openCreateModal() {
    const activeFilters = getActiveFilters();
    const activeRange = getPeriodRange(activeFilters);
    setReportDraft({
      ...activeFilters,
      from: activeRange.valid ? activeRange.from : activeFilters.from,
      to: activeRange.valid ? activeRange.to : activeFilters.to,
    });
    setCreateError('');
    setIsCreateModalOpen(true);
  }

  function closeCreateModal() {
    if (createLoading) return;
    setIsCreateModalOpen(false);
    setCreateError('');
  }

  async function createReport(event) {
    event.preventDefault();
    const request = buildProductReportRequest(reportDraft);
    if (!request.valid) {
      setCreateError(request.message);
      return;
    }

    setCreateLoading(true);
    setCreateError('');
    try {
      const endpoint = `${API}/stats/product-report?${request.params.toString()}`;
      console.info('[ProductReport] createReport -> requesting', {
        endpoint,
        draft: reportDraft,
        range: request.range,
      });
      const res = await fetch(endpoint);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Kh?ng t?o du?c b?o c?o s?n ph?m');

      const appliedDraft = { ...reportDraft, from: request.range.from, to: request.range.to };
      if (reportDraft.period === 'day') appliedDraft.selectedDate = request.range.from;
      applyFiltersToPage(appliedDraft);
      setReport(data);
      setLastFetchedAt(new Date());
      setError('');
      setCreatedNotice(`?? t?o b?o c?o ${getPeriodDescription(appliedDraft, request.range)} ? ${getStatusLabel(appliedDraft.status)} ? ${formatNumber(data.summary?.orderCount)} don h?ng ? ${formatNumber(data.summary?.totalQuantity)} s?n ph?m ? ${formatVND(data.summary?.totalRevenue)}.`);
      setIsCreateModalOpen(false);
    } catch (err) {
      setCreateError(err.message || 'Kh?ng t?o du?c b?o c?o s?n ph?m');
    } finally {
      setCreateLoading(false);
    }
  }

  function resetFilters() {
    setPeriod(defaultFilters.period);
    setSelectedDate(defaultFilters.selectedDate);
    setSelectedMonth(defaultFilters.selectedMonth);
    setSelectedYear(defaultFilters.selectedYear);
    setFrom(defaultFilters.from);
    setTo(defaultFilters.to);
    setStatus(defaultFilters.status);
    setError('');
    setReport(null);
    setLastFetchedAt(null);
    setCreatedNotice('');
  }

  function exportExcel() {
    if (!canExport) return;

    const range = report?.metadata || report?.filters || selectedRange;
    const detailRows = rows.map((row, index) => ({
      STT: index + 1,
      Ngay: formatDateKey(row.date),
      "Ten phien ban": row.productName || '',
      "Ma SKU": row.sku || '',
      "So luong hang ban": Number(row.quantitySold) || 0,
      "Tien hang": Number(row.grossAmount) || 0,
      "Chiet khau san pham": Number(row.productDiscount) || 0,
      "Chiet khau phan bo": Number(row.allocatedDiscount) || 0,
      Thue: Number(row.taxAmount) || 0,
      "Thanh tien": Number(row.netAmount) || 0,
      "So don": Number(row.orderCount) || 0,
    }));

    detailRows.push({
      STT: '',
      Ngay: '',
      "Ten phien ban": 'TONG CONG',
      "Ma SKU": '',
      "So luong hang ban": Number(summary.totalQuantity) || 0,
      "Tien hang": Number(summary.grossAmount) || 0,
      "Chiet khau san pham": Number(summary.productDiscount) || 0,
      "Chiet khau phan bo": Number(summary.allocatedDiscount) || 0,
      Thue: Number(summary.taxAmount) || 0,
      "Thanh tien": Number(summary.netAmount) || 0,
      "So don": Number(summary.orderCount) || 0,
    });

    const summaryRows = [
      { 'Ch? ti?u': 'T? ng?y', 'Gi? tr?': formatDateKey(range.from) },
      { 'Ch? ti?u': '??n ng?y', 'Gi? tr?': formatDateKey(range.to) },
      { 'Ch? ti?u': 'Ki?u th?i gian', 'Gi? tr?': PERIOD_OPTIONS.find(option => option.value === (range.period || period))?.label || period },
      { 'Ch? ti?u': 'Tr?ng th?i don', 'Gi? tr?': STATUS_OPTIONS.find(option => option.value === (range.status || status))?.label || status },
      { 'Ch? ti?u': 'S? don h?ng', 'Gi? tr?': Number(summary.orderCount) || 0 },
      { 'Ch? ti?u': 'T?ng s? s?n ph?m b?n', 'Gi? tr?': Number(summary.totalQuantity) || 0 },
      { 'Ch? ti?u': 'T?ng doanh thu', 'Gi? tr?': Number(summary.totalRevenue) || 0 },
      { 'Ch? ti?u': 'Xu?t l?c', 'Gi? tr?': new Date().toLocaleString('vi-VN') },
    ];

    const workbook = XLSX.utils.book_new();
    const detailSheet = XLSX.utils.json_to_sheet(detailRows);
    const summarySheet = XLSX.utils.json_to_sheet(summaryRows);
    detailSheet['!cols'] = [
      { wch: 6 },
      { wch: 14 },
      { wch: 34 },
      { wch: 18 },
      { wch: 18 },
      { wch: 16 },
      { wch: 22 },
      { wch: 22 },
      { wch: 14 },
      { wch: 16 },
      { wch: 10 },
    ];
    summarySheet['!cols'] = [{ wch: 28 }, { wch: 28 }];

    XLSX.utils.book_append_sheet(workbook, detailSheet, safeSheetName('Bao cao san pham'));
    XLSX.utils.book_append_sheet(workbook, summarySheet, safeSheetName('Tong hop'));
    XLSX.writeFile(workbook, `BaoCaoSanPham_${safeFilePart(range.from)}_den_${safeFilePart(range.to)}.xlsx`);
  }

  const rangeLabel = selectedRange.valid
    ? `T? ${formatDateKey(selectedRange.from)} d?n ${formatDateKey(selectedRange.to)}`
    : selectedRange.message;
  const rangePickerFrom = period === 'custom' ? from : (selectedRange.valid ? selectedRange.from : from);
  const rangePickerTo = period === 'custom' ? to : (selectedRange.valid ? selectedRange.to : to);

  function updateInlineRange(nextRange) {
    setPeriod('custom');
    setFrom(nextRange.from);
    setTo(nextRange.to);
    setError('');
  }

  function handleInlineRangeFromChange(value) {
    updateInlineRange({
      from: normalizeDateInputValue(value),
      to: normalizeDateInputValue(rangePickerTo),
    });
  }

  function handleInlineRangeToChange(value) {
    updateInlineRange({
      from: normalizeDateInputValue(rangePickerFrom),
      to: normalizeDateInputValue(value),
    });
  }

  return (
    <div className="space-y-4">
      <div className="overflow-visible rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="rounded-t-2xl bg-gradient-to-r from-blue-900 via-slate-900 to-purple-900 px-5 py-5 text-white">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="h-11 w-11 rounded-2xl bg-white/10 flex items-center justify-center border border-white/10">
                  <BarChart3 size={23} className="text-blue-200" />
                </div>
                <div>
                  <div className="text-xs uppercase tracking-[0.25em] text-blue-200/80">Product Sales Report</div>
                  <h1 className="text-2xl font-bold">B?o c?o th?ng k? s?n ph?m</h1>
                </div>
              </div>
              <p className="text-sm text-blue-100/80 max-w-3xl">
                Th?ng k? s? don h?ng, s? lu?ng s?n ph?m d? b?n v? doanh thu theo ng?y/th?ng/nam. M?c d?nh ch? t?nh don ho?n th?nh v? lo?i tr? don h?y.
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row lg:items-center">
              <button
                type="button"
                onClick={openCreateModal}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-blue-900 shadow-sm hover:bg-blue-50"
              >
                <FilePlus size={16} /> Th?m b?o c?o
              </button>
              <button
                type="button"
                onClick={exportExcel}
                disabled={!canExport}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-white/20 disabled:text-white/60"
              >
                <Download size={16} /> Xuất Excel
              </button>
            </div>
          </div>
        </div>

        <div className="p-5 bg-gray-50 border-t border-white/10">
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-[170px_minmax(170px,0.9fr)_minmax(300px,1.35fr)_180px_auto]">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Ki?u th?i gian</label>
              <select className="input-field w-full" value={period} onChange={e => setPeriod(e.target.value)}>
                {PERIOD_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>

            {period === 'day' && (
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">Ng?y t?o don</label>
                <DatePickerField value={selectedDate} onChange={setSelectedDate} ariaLabel="Ch?n ng?y t?o don" />
              </div>
            )}

            {period === 'month' && (
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">Th?ng t?o don</label>
                <div className="relative">
                  <Calendar size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input type="month" className="input-field w-full pl-9" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} />
                </div>
              </div>
            )}

            {period === 'year' && (
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">Nam t?o don</label>
                <div className="relative">
                  <Calendar size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="number"
                    min="1900"
                    max="9999"
                    className="input-field w-full pl-9"
                    value={selectedYear}
                    onChange={e => setSelectedYear(e.target.value)}
                  />
                </div>
              </div>
            )}

            <div className="xl:col-span-2">
              <label className="mb-1 block text-xs font-medium text-gray-500">Kho?ng ng?y</label>
              <DateRangeInlinePicker
                from={rangePickerFrom}
                to={rangePickerTo}
                label={rangeLabel}
                onFromChange={handleInlineRangeFromChange}
                onToChange={handleInlineRangeToChange}
                onApply={({ from: appliedFrom, to: appliedTo }) => applyQuickDateRange({ from: appliedFrom, to: appliedTo })}
                disabled={loading}
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Tr?ng th?i don</label>
              <select className="input-field w-full" value={status} onChange={e => setStatus(e.target.value)}>
                {STATUS_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>

            <div className="flex items-end gap-2">
              <button
                type="button"
                onClick={() => fetchReport()}
                disabled={!canFetch}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300 xl:w-auto"
              >
                {loading ? <Loader size={16} className="animate-spin" /> : <Search size={16} />}
                Th?ng k?
              </button>
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-gray-500 hover:bg-gray-100"
                title="??t l?i b? l?c"
              >
                <RefreshCw size={16} />
              </button>
            </div>
          </div>

          <div className="mt-3 flex flex-col gap-2 text-xs text-gray-500 md:flex-row md:items-center md:justify-between">
            <div>
              <span className="font-medium text-gray-600">B? l?c:</span> {rangeLabel} ? {STATUS_OPTIONS.find(option => option.value === status)?.label || status}
            </div>
            <div>
              {report?.metadata?.timezone ? `M?i gi?: ${report.metadata.timezone}` : 'M?i gi?: Asia/Saigon'}
              {lastFetchedAt ? ` · Cập nhật: ${formatDateTime(lastFetchedAt)}` : ''}
            </div>
          </div>

          {createdNotice && (
            <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
              {createdNotice}
            </div>
          )}

          {error && (
            <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
              {error}
            </div>
          )}
        </div>
      </div>

      {report && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-blue-700">
            <div className="flex items-center gap-2 text-xs font-medium opacity-80">
              <ShoppingCart size={15} /> S? lu?ng don h?ng
            </div>
            <div className="mt-1 text-2xl font-bold">{formatNumber(summary.orderCount)}</div>
            <div className="mt-1 text-xs opacity-80">{getStatusLabel(report?.metadata?.status || status)} trong k?</div>
          </div>
          <div className="rounded-2xl border border-purple-100 bg-purple-50 px-4 py-3 text-purple-700">
            <div className="flex items-center gap-2 text-xs font-medium opacity-80">
              <Package size={15} /> T?ng s?n ph?m d? b?n
            </div>
            <div className="mt-1 text-2xl font-bold">{formatNumber(summary.totalQuantity)}</div>
            <div className="mt-1 text-xs opacity-80">T?ng s? lu?ng t? chi ti?t don h?ng</div>
          </div>
          <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-emerald-700">
            <div className="flex items-center gap-2 text-xs font-medium opacity-80">
              <DollarSign size={15} /> T?ng doanh thu
            </div>
            <div className="mt-1 text-2xl font-bold">{formatVND(summary.totalRevenue)}</div>
            <div className="mt-1 text-xs opacity-80">T?nh theo t?ng ti?n h?a don</div>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-col gap-2 border-b border-gray-100 px-5 py-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <FileText size={18} className="text-blue-600" />
              <h2 className="font-bold text-gray-800">B?ng b?o c?o s?n ph?m</h2>
            </div>
            <p className="mt-1 text-sm text-gray-500">
              T?ng h?p theo ng?y v? s?n ph?m/SKU: s? lu?ng b?n, ti?n h?ng, chi?t kh?u, thu? v? th?nh ti?n.
            </p>
          </div>
          {report && (
            <div className="text-sm font-medium text-gray-600">
              {formatNumber(rows.length)} d?ng ? {formatVND(summary.netAmount)} th?nh ti?n d?ng h?ng
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3 text-left">Ng?y</th>
                <th className="px-4 py-3 text-left">T?n phi?n b?n</th>
                <th className="px-4 py-3 text-left">M? SKU</th>
                <th className="px-4 py-3 text-right">S? lu?ng h?ng b?n</th>
                <th className="px-4 py-3 text-right">Ti?n h?ng</th>
                <th className="px-4 py-3 text-right">Chiết khấu sản phẩm</th>
                <th className="px-4 py-3 text-right">Chi?t kh?u ph?n b?</th>
                <th className="px-4 py-3 text-right">Thuế</th>
                <th className="px-4 py-3 text-right">Th?nh ti?n</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`${row.date}-${row.sku}-${row.productId || row.variantId || row.comboId || index}`} className="border-t border-gray-100 align-top hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-700">{formatDateKey(row.date)}</td>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-gray-900">{row.productName || 'Sản phẩm'}</div>
                    <div className="mt-0.5 text-xs text-gray-400">{row.type === 'combo' ? 'Combo' : 'S?n ph?m/bi?n th?'} ? {formatNumber(row.orderCount)} don</div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{row.sku || '?'}</td>
                  <td className="px-4 py-3 text-right font-semibold text-blue-700">{formatNumber(row.quantitySold)}</td>
                  <td className="px-4 py-3 text-right text-gray-700">{formatVND(row.grossAmount)}</td>
                  <td className="px-4 py-3 text-right text-rose-600">{formatVND(row.productDiscount)}</td>
                  <td className="px-4 py-3 text-right text-rose-600">{formatVND(row.allocatedDiscount)}</td>
                  <td className="px-4 py-3 text-right text-amber-600">{formatVND(row.taxAmount)}</td>
                  <td className="px-4 py-3 text-right font-bold text-gray-900">{formatVND(row.netAmount)}</td>
                </tr>
              ))}
              {rows.length > 0 && (
                <tr className="border-t-2 border-gray-200 bg-gray-50 font-bold">
                  <td className="px-4 py-3" colSpan={3}>T?ng c?ng</td>
                  <td className="px-4 py-3 text-right text-blue-700">{formatNumber(summary.totalQuantity)}</td>
                  <td className="px-4 py-3 text-right">{formatVND(summary.grossAmount)}</td>
                  <td className="px-4 py-3 text-right text-rose-600">{formatVND(summary.productDiscount)}</td>
                  <td className="px-4 py-3 text-right text-rose-600">{formatVND(summary.allocatedDiscount)}</td>
                  <td className="px-4 py-3 text-right text-amber-600">{formatVND(summary.taxAmount)}</td>
                  <td className="px-4 py-3 text-right text-blue-700">{formatVND(summary.netAmount)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-gray-400">
            <Loader size={32} className="animate-spin text-blue-400" />
            <div className="font-medium text-gray-600">?ang l?p b?o c?o s?n ph?m...</div>
          </div>
        ) : report && rows.length === 0 ? (
          <div className="py-16 text-center">
            <div className="mb-3 text-5xl opacity-20">?Y"?</div>
            <div className="font-semibold text-gray-600">Kh?ng c? s?n ph?m b?n ra trong kho?ng th?i gian d? ch?n</div>
            <div className="mt-1 text-sm text-gray-400">B?o c?o ch? t?nh don ph? h?p tr?ng th?i d? ch?n v? lu?n lo?i tr? don h?y.</div>
          </div>
        ) : !report ? (
          <div className="py-16 text-center">
            <div className="mb-3 text-5xl opacity-20">?Y"S</div>
            <div className="font-semibold text-gray-600">Chua c? d? li?u b?o c?o</div>
            <div className="mt-1 text-sm text-gray-400">Ch?n b? l?c th?i gian r?i nh?n ?Th?ng k?.</div>
          </div>
        ) : null}
      </div>

      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/50 px-4 py-6 backdrop-blur-sm sm:items-center">
          <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl">
            <div className="rounded-t-2xl bg-gradient-to-r from-blue-900 via-slate-900 to-purple-900 px-5 py-4 text-white">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-blue-200/80">
                    <FilePlus size={15} /> New Product Report
                  </div>
                  <h3 className="mt-1 text-xl font-bold">T?o b?o c?o s?n ph?m</h3>
                  <p className="mt-1 text-sm text-blue-100/80">
                    Ch?n k? b?o c?o, tr?ng th?i don v? t?o b?o c?o t? d? li?u don h?ng hi?n c?.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeCreateModal}
                  disabled={createLoading}
                  className="rounded-xl border border-white/10 bg-white/10 p-2 text-white hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-60"
                  aria-label="??ng form t?o b?o c?o"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <form onSubmit={createReport} className="space-y-4 p-5">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-semibold text-gray-700">Lo?i b?o c?o</label>
                  <select
                    className="input-field w-full"
                    value={reportDraft.period}
                    onChange={e => updateReportDraft('period', e.target.value)}
                    disabled={createLoading}
                  >
                    {PERIOD_OPTIONS.map(option => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>

                {reportDraft.period === 'day' && (
                  <div>
                    <label className="mb-1 block text-sm font-semibold text-gray-700">Ng?y b?o c?o</label>
                    <DatePickerField
                      value={reportDraft.selectedDate}
                      onChange={value => updateReportDraft('selectedDate', value)}
                      disabled={createLoading}
                      ariaLabel="Ch?n ng?y b?o c?o"
                    />
                  </div>
                )}

                {reportDraft.period === 'month' && (
                  <div>
                    <label className="mb-1 block text-sm font-semibold text-gray-700">Th?ng b?o c?o</label>
                    <div className="relative">
                      <Calendar size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        type="month"
                        className="input-field w-full pl-9"
                        value={reportDraft.selectedMonth}
                        onChange={e => updateReportDraft('selectedMonth', e.target.value)}
                        disabled={createLoading}
                      />
                    </div>
                  </div>
                )}

                {reportDraft.period === 'year' && (
                  <div>
                    <label className="mb-1 block text-sm font-semibold text-gray-700">Nam b?o c?o</label>
                    <div className="relative">
                      <Calendar size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        type="number"
                        min="1900"
                        max="9999"
                        className="input-field w-full pl-9"
                        value={reportDraft.selectedYear}
                        onChange={e => updateReportDraft('selectedYear', e.target.value)}
                        disabled={createLoading}
                      />
                    </div>
                  </div>
                )}

                {reportDraft.period === 'custom' && (
                  <div className="rounded-2xl border border-blue-100 bg-blue-50/50 p-3 md:col-span-2">
                    <div className="flex items-start gap-2 text-sm font-bold text-blue-800">
                      <Calendar size={16} className="mt-0.5 shrink-0" />
                      <div>
                        <div>Kho?ng ng?y t?y ch?nh</div>
                        <p className="mt-1 text-xs font-medium text-blue-700/75">
                          Ch?n d?c l?p ng?y b?t d?u v? ng?y k?t th?c, h? th?ng l?c bao g?m c? hai ng?y d? ch?n.
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-sm font-semibold text-gray-700">Ng?y b?t d?u</label>
                        <DatePickerField
                          value={reportDraft.from}
                          onChange={value => updateReportDraft('from', value)}
                          disabled={createLoading}
                          ariaLabel="Ch?n ng?y b?t d?u"
                          maxDate={normalizeDateInputValue(reportDraft.to)}
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-sm font-semibold text-gray-700">Ng?y k?t th?c</label>
                        <DatePickerField
                          value={reportDraft.to}
                          onChange={value => updateReportDraft('to', value)}
                          disabled={createLoading}
                          ariaLabel="Ch?n ng?y k?t th?c"
                          minDate={normalizeDateInputValue(reportDraft.from)}
                        />
                      </div>
                    </div>
                  </div>
                )}

                <div>
                  <label className="mb-1 block text-sm font-semibold text-gray-700">Tr?ng th?i don</label>
                  <select
                    className="input-field w-full"
                    value={reportDraft.status}
                    onChange={e => updateReportDraft('status', e.target.value)}
                    disabled={createLoading}
                  >
                    {STATUS_OPTIONS.map(option => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-semibold text-gray-700">Kho?ng d? li?u</label>
                  <div className={`flex min-h-[44px] items-center rounded-xl border px-3 py-2 text-sm font-medium ${createRange.valid ? 'border-blue-100 bg-blue-50 text-blue-700' : 'border-red-200 bg-red-50 text-red-600'}`}>
                    {createRange.valid
                      ? `T? ${formatDateKey(createRange.from)} d?n ${formatDateKey(createRange.to)}`
                      : createRange.message}
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
                B?o c?o s? g?i API hi?n c?, lu?n lo?i tr? don b? h?y v? c?p nh?t ngay b?ng c?ng 3 ch? s?: s? don h?ng, t?ng s?n ph?m d? b?n, t?ng doanh thu.
              </div>

              {createError && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
                  {createError}
                </div>
              )}

              <div className="flex flex-col-reverse gap-2 border-t border-gray-100 pt-4 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={closeCreateModal}
                  disabled={createLoading}
                  className="inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  H?y
                </button>
                <button
                  type="submit"
                  disabled={createLoading}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                >
                  {createLoading ? <Loader size={16} className="animate-spin" /> : <FilePlus size={16} />}
                  T?o b?o c?o
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showHelp && (
        <HelpModal
          show={showHelp}
          onClose={() => setShowHelp(false)}
          title="Hu?ng d?n b?o c?o s?n ph?m"
          content={[
            'Bu?c 1: Ch?n k? b?o c?o theo ng?y, th?ng, nam ho?c kho?ng th?i gian t?y ch?nh.',
            'Bu?c 2: Ch?n tr?ng th?i don h?ng d? quy?t d?nh d? li?u n?o du?c t?nh v?o b?o c?o.',
            'Bu?c 3: Xem tru?c kho?ng d? li?u d? ki?m tra l?i m?c th?i gian tru?c khi t?o b?o c?o.',
            'Bu?c 4: Nh?n T?o b?o c?o d? t?i s? lu?ng b?n, doanh thu v? danh s?ch s?n ph?m theo k?.',
            'Bu?c 5: D?ng n?t xu?t file d? t?i Excel khi c?n d?i so?t ho?c g?i qu?n l?.',
          ]}
        />
      )}
    </div>
  );
}
