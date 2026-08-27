import type { MouseEventHandler } from 'react';

type ToggleProps = {
  name: string;
  enabled: boolean;
  disabled?: boolean;
  className?: string;
  onClick: MouseEventHandler<HTMLButtonElement>;
};

export function Toggle({ name, enabled, disabled = false, className = '', onClick }: ToggleProps) {
  return (
    <button
      type="button"
      className={`toggle-switch ${enabled ? 'is-on' : ''} ${className}`}
      disabled={disabled}
      onClick={onClick}
      role="switch"
      aria-label={`Toggle ${name}`}
      aria-checked={enabled}
    >
      <span />
    </button>
  );
}
