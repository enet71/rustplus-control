import { Toggle } from '../../shared/ui/toggle';
import type { Device, StorageState } from '../../shared/api-types';
import type { MoveDirection } from './use-devices';

type DeviceRowProps = {
  device: Device;
  enabled: boolean | undefined;
  storage: StorageState | undefined;
  child?: boolean;
  position: number;
  count: number;
  pending: boolean;
  onToggle: (device: Device, enabled: boolean) => void;
  onRename: (device: Device) => void;
  onMove: (device: Device, direction: MoveDirection) => void;
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

export function DeviceRow({
  device,
  enabled,
  storage,
  child = false,
  position,
  count,
  pending,
  onToggle,
  onRename,
  onMove,
}: DeviceRowProps) {
  const isStorage = device.type === 'storage';
  return (
    <article
      className={`control-row ${isStorage ? 'storage-row' : ''} ${child ? 'group-child' : ''}`}
    >
      <div className={isStorage ? 'storage-header' : 'control-info'}>
        <div className="control-info">
          <h3>
            {device.iconUrl && <img className="device-icon" src={device.iconUrl} alt="" />}
            {device.name}
          </h3>
          <p>{deviceStateLabel(device, enabled, storage)}</p>
        </div>
        <div className="control-actions">
          <button
            className="sort-button"
            disabled={position === 0}
            onClick={() => onMove(device, -1)}
            aria-label="Move up"
          >
            &#8593;
          </button>
          <button
            className="sort-button"
            disabled={position === count - 1}
            onClick={() => onMove(device, 1)}
            aria-label="Move down"
          >
            &#8595;
          </button>
          <button className="secondary" onClick={() => onRename(device)}>
            Rename
          </button>
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
      {isStorage && storage && (
        <ul className="storage-items">
          {storage.items.map((item, index) => (
            <li
              key={`${index}:${item.itemId}`}
              title={item.item?.displayName || `Item ${item.itemId}`}
            >
              {item.item?.iconUrl && <img src={item.item.iconUrl} alt="" />}
              <strong>{item.quantity}</strong>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
