'use client';

import { NUIT_DIGIT_LENGTH, normalizeNuit } from '@/lib/licensing/normalizeLicenseMeta';

export type NuitInputProps = {
  value: string;
  onChange: (value: string) => void;
  showCounter?: boolean;
  required?: boolean;
  className?: string;
  id?: string;
  disabled?: boolean;
};

export function NuitInput({
  value,
  onChange,
  showCounter = false,
  required = false,
  className = '',
  id,
  disabled = false,
}: NuitInputProps) {
  const digits = normalizeNuit(value);

  return (
    <div className="relative">
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        required={required}
        disabled={disabled}
        value={digits}
        maxLength={NUIT_DIGIT_LENGTH}
        onChange={(event) => onChange(normalizeNuit(event.target.value))}
        className={className}
        placeholder={'0'.repeat(NUIT_DIGIT_LENGTH)}
        aria-label={`NUIT (${NUIT_DIGIT_LENGTH} dígitos)`}
      />
      {showCounter ? (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-mono text-xs text-zinc-500">
          {digits.length}/{NUIT_DIGIT_LENGTH}
        </span>
      ) : null}
    </div>
  );
}
