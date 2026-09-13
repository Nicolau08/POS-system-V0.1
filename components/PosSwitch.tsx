'use client';

type PosSwitchProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Texto à direita do switch */
  label?: string;
  className?: string;
  title?: string;
  id?: string;
};

/**
 * Switch padrão POSly — usar em toda a app para manter o mesmo visual.
 */
export function PosSwitch({
  checked,
  onChange,
  disabled = false,
  label,
  className = '',
  title,
  id,
}: PosSwitchProps) {
  const switchControl = (
    <button
      type="button"
      id={id}
      role="switch"
      title={title}
      aria-checked={checked}
      aria-label={label || title}
      disabled={disabled}
      onClick={(event) => {
        event.preventDefault();
        if (disabled) return;
        onChange(!checked);
      }}
      className={[
        'relative box-border h-6 w-11 shrink-0 rounded-full border transition-colors duration-200',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0001fb]/45 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950',
        'disabled:cursor-not-allowed disabled:opacity-45',
        checked
          ? 'border-[#0001fb] bg-[#0001fb] shadow-[0_0_0_3px_rgba(0, 1, 251,0.18)]'
          : 'border-zinc-500/80 bg-zinc-600',
        !label ? className : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <span
        className={[
          'pointer-events-none absolute top-[2px] h-[18px] w-[18px] rounded-full bg-[#f5f4fb] shadow-md',
          'transition-[left,right] duration-200 ease-out',
          checked ? 'left-auto right-[2px]' : 'left-[2px] right-auto',
        ].join(' ')}
      />
    </button>
  );

  if (!label) return switchControl;

  return (
    <label
      className={[
        'inline-flex items-center gap-2.5 select-none',
        disabled ? 'cursor-not-allowed opacity-80' : 'cursor-pointer',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {switchControl}
      <span className="text-xs text-pos-fg-soft">{label}</span>
    </label>
  );
}
