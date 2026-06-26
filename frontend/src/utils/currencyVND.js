export function formatCurrencyVND(value = 0) {
  if (value === null || value === undefined || value === '') return '0';

  const numberValue =
    typeof value === 'number'
      ? value
      : Number(String(value).replace(/[^\d-]/g, ''));

  if (!Number.isFinite(numberValue)) return '0';

  return new Intl.NumberFormat('vi-VN').format(numberValue);
}

export function parseCurrencyVND(value = 0) {
  if (value === null || value === undefined || value === '') return 0;

  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value) : 0;

  const cleaned = String(value).replace(/[^\d-]/g, '');
  const numberValue = Number(cleaned);

  return Number.isFinite(numberValue) ? numberValue : 0;
}

export function toCurrencyVNDInteger(value, fallback = 0) {
  const parsed = parseCurrencyVND(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

export function formatOptionalCurrencyVND(value, fallback = '—') {
  if (value === undefined || value === null || value === '') return fallback;
  return formatCurrencyVND(value);
}
