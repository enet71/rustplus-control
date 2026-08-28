import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Toggle } from '../../shared/ui/toggle';
import type { Device, StorageState } from '../../shared/api-types';

type DeviceRowProps = {
  device: Device;
  enabled: boolean | undefined;
  storage: StorageState | undefined;
  child?: boolean;
  pending: boolean;
  onToggle: (device: Device, enabled: boolean) => void;
  onRename: (device: Device) => void;
};

export function deviceStateLabel(
  device: Device,
  enabled: boolean | undefined,
  storage: StorageState | undefined,
): string {
  if (device.type === 'storage')
    return storage
      ? `${storage.items.length} / ${storage.capacity || '?'} slots used`
      : 'Storage state unknown';
  if (enabled === undefined) return 'State unknown';
  if (device.type === 'alarm') return enabled ? 'Alarm active' : 'Monitoring';
  return enabled ? 'Powered on' : 'Powered off';
}

/** The left accent border mirrors the device's on/off (or alarm) state. */
function accentBorderClass(device: Device, enabled: boolean | undefined): string {
  if (device.type === 'switch') {
    if (enabled === undefined) return 'border-l-border';
    return enabled ? 'border-l-success' : 'border-l-destructive';
  }
  if (device.type === 'alarm') return enabled ? 'border-l-destructive' : 'border-l-border';
  return 'border-l-border';
}

export function DeviceRow({
  device,
  enabled,
  storage,
  child = false,
  pending,
  onToggle,
  onRename,
}: DeviceRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: device.entityId,
  });
  const isStorage = device.type === 'storage';
  return (
    <article
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex items-center gap-4 rounded-lg border border-border border-l-[3px] bg-card p-3.5 transition-colors hover:bg-muted',
        accentBorderClass(device, enabled),
        isStorage && 'flex-col items-stretch',
        child && 'ml-7',
        isDragging && 'opacity-60',
      )}
    >
      <div className={cn('flex items-center gap-4', isStorage ? 'w-full' : 'min-w-0 flex-1')}>
        <button
          type="button"
          className="flex size-6 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground hover:text-foreground active:cursor-grabbing"
          aria-label={`Reorder ${device.name}`}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
        </button>
        <div
          className={cn(
            'flex min-w-0 gap-4',
            isStorage
              ? 'w-full items-start justify-between'
              : 'flex-1 items-center justify-between',
          )}
        >
          <div className="min-w-0 flex-1">
            <h3 className="flex items-center gap-2 font-semibold break-words">
              {device.iconUrl && (
                <img
                  className="size-7 shrink-0 rounded-md bg-input-background object-contain p-0.5"
                  src={device.iconUrl}
                  alt=""
                />
              )}
              {device.name}
            </h3>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {deviceStateLabel(device, enabled, storage)}
            </p>
          </div>
          <div className={cn('flex shrink-0 items-center gap-2', isStorage && 'mt-0.5')}>
            <Button variant="secondary" onClick={() => onRename(device)}>
              Rename
            </Button>
            {device.type === 'switch' && (
              <Toggle
                name={device.name}
                enabled={enabled === true}
                disabled={pending}
                onClick={() => onToggle(device, enabled !== true)}
              />
            )}
          </div>
        </div>
      </div>
      {isStorage && storage && (
        <ul className="mt-3 grid grid-cols-6 gap-2 max-[760px]:grid-cols-4 max-[440px]:grid-cols-3">
          {storage.items.map((item, index) => (
            <li
              key={`${index}:${item.itemId}`}
              title={item.item?.displayName || `Item ${item.itemId}`}
              className="relative grid min-h-[68px] place-items-center rounded-md border border-border bg-input-background p-2"
            >
              {item.item?.iconUrl && (
                <img className="size-[42px] object-contain" src={item.item.iconUrl} alt="" />
              )}
              <strong className="absolute right-1.5 bottom-1 min-w-[18px] rounded-sm bg-secondary px-1 text-center text-xs font-normal text-foreground">
                {item.quantity}
              </strong>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
