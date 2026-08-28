import { Switch } from '@/components/ui/switch';

type ToggleProps = {
  name: string;
  enabled: boolean;
  disabled?: boolean;
  className?: string;
  onClick: () => void;
};

export function Toggle({ name, enabled, disabled = false, className, onClick }: ToggleProps) {
  return (
    <Switch
      checked={enabled}
      disabled={disabled}
      onCheckedChange={onClick}
      aria-label={`Toggle ${name}`}
      className={className}
    />
  );
}
