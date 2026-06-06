export default function QuantityStepper({
  value,
  onChange,
  onDecrease,
  onIncrease,
  min = 1,
  step = 1,
  disabled = false,
  className = '',
  inputClassName = '',
  buttonClassName = '',
}) {
  const sharedButtonClassName = `flex h-9 w-9 items-center justify-center text-base font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${buttonClassName}`.trim();

  return (
    <div className={`inline-flex items-center overflow-hidden rounded-lg border border-gray-300 bg-white shadow-sm ${className}`.trim()}>
      <button
        type="button"
        onClick={onDecrease}
        disabled={disabled || Number(value) <= Number(min)}
        className={`${sharedButtonClassName} border-r border-gray-300 text-gray-600 hover:bg-gray-100 hover:text-gray-900`}
        aria-label={`Giảm số lượng ${step}`}
      >
        −
      </button>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        disabled={disabled}
        className={`h-9 w-16 min-w-0 border-0 px-2 text-center text-sm font-semibold outline-none focus:ring-0 disabled:bg-gray-50 ${inputClassName}`.trim()}
        aria-label="Số lượng"
      />
      <button
        type="button"
        onClick={onIncrease}
        disabled={disabled}
        className={`${sharedButtonClassName} border-l border-gray-300 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700`}
        aria-label={`Tăng số lượng ${step}`}
      >
        +
      </button>
    </div>
  );
}
