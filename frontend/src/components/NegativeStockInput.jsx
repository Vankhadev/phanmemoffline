import { AlertTriangle } from 'lucide-react';
import {
  NEGATIVE_STOCK_INPUT_PLACEHOLDER,
  getNegativeStockInputError,
  parseStockInputNumber,
} from '../utils/negativeStock';

export default function NegativeStockInput({
  id,
  label = 'Xuất âm',
  value,
  onChange,
  disabled = false,
  error = '',
  helper = '',
  className = '',
  inputClassName = '',
  compact = false,
  showBadge = true,
  onLimitError,
  settings,
}) {
  const textValue = value === undefined || value === null ? '' : String(value);
  const numericValue = parseStockInputNumber(textValue, null);
  const derivedError = error || getNegativeStockInputError(textValue, settings);
  const isNegative = Number.isFinite(numericValue) && numericValue < 0;
  const hasError = Boolean(derivedError);
  const badgeLabel = isNegative || hasError ? '�m kho' : 'Cho ph�p �m';

  const handleChange = (event) => {
    const nextValue = event.target.value;
    const nextError = getNegativeStockInputError(nextValue, settings);
    onChange?.(nextValue, event);
    if (nextError) onLimitError?.(nextError, nextValue);
  };

  return (
    <div className={`negative-stock-input ${compact ? 'negative-stock-input-compact' : ''} ${className}`}>
      {(label || showBadge) && (
        <div className="negative-stock-input-label-row">
          {label && <label htmlFor={id} className="negative-stock-input-label">{label}</label>}
          {showBadge && (
            <span className={`negative-stock-input-pill ${isNegative || hasError ? 'negative-stock-input-pill-danger' : 'negative-stock-input-pill-muted'}`}>
              <AlertTriangle size={compact ? 12 : 14} />
              {badgeLabel}
            </span>
          )}
        </div>
      )}
      <div className={`negative-stock-input-shell ${hasError ? 'negative-stock-input-shell-error' : isNegative ? 'negative-stock-input-shell-danger' : ''} ${disabled ? 'negative-stock-input-shell-disabled' : ''}`}>
        <AlertTriangle className={`negative-stock-input-icon ${isNegative || hasError ? 'text-red-500' : 'text-amber-500'}`} size={compact ? 14 : 16} aria-hidden="true" />
        <input
          id={id}
          type="number"
          inputMode="decimal"
          step="1"
          autoComplete="off"
          value={textValue}
          onChange={handleChange}
          placeholder={NEGATIVE_STOCK_INPUT_PLACEHOLDER}
          disabled={disabled}
          aria-invalid={hasError}
          className={`negative-stock-input-field ${hasError ? 'negative-stock-input-field-error' : isNegative ? 'negative-stock-input-field-negative' : ''} ${inputClassName}`}
        />
      </div>
      {(derivedError || helper) && (
        <div className={`negative-stock-input-helper ${derivedError ? 'negative-stock-input-helper-error' : ''}`}>
          {derivedError || helper}
        </div>
      )}
    </div>
  );
}
