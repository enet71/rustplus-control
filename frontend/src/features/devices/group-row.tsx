import { Toggle } from '../../shared/ui/toggle';
import type { Device, DeviceGroup } from '../../shared/api-types';
import type { MoveDirection } from './use-devices';

type GroupRowProps = {
  group: DeviceGroup;
  members: Device[];
  switchCount: number;
  enabled: boolean;
  collapsed: boolean;
  position: number;
  count: number;
  pending: boolean;
  onToggle: (group: DeviceGroup, enabled: boolean) => void;
  onToggleCollapsed: (groupId: string) => void;
  onEdit: (group: DeviceGroup) => void;
  onMove: (group: DeviceGroup, direction: MoveDirection) => void;
};

export function GroupRow({
  group,
  members,
  switchCount,
  enabled,
  collapsed,
  position,
  count,
  pending,
  onToggle,
  onToggleCollapsed,
  onEdit,
  onMove,
}: GroupRowProps) {
  return (
    <article className="control-row group-row">
      <div className="control-info">
        <h3>{group.name}</h3>
        <p>
          {members.length} device{members.length === 1 ? '' : 's'}
        </p>
      </div>
      <div className="control-actions group-actions">
        <button className="secondary edit-group" onClick={() => onEdit(group)}>
          Edit
        </button>
        <button
          className={`collapse-group ${collapsed ? 'is-collapsed' : ''}`}
          onClick={() => onToggleCollapsed(group.id)}
          aria-label="Collapse group"
          aria-expanded={!collapsed}
        >
          <span className="collapse-icon" />
        </button>
        <button
          className="sort-button move-up"
          disabled={position === 0}
          onClick={() => onMove(group, -1)}
          aria-label="Move up"
        >
          &#8593;
        </button>
        <button
          className="sort-button move-down"
          disabled={position === count - 1}
          onClick={() => onMove(group, 1)}
          aria-label="Move down"
        >
          &#8595;
        </button>
        {switchCount > 0 && (
          <Toggle
            name={group.name}
            className="group-switch"
            enabled={enabled}
            disabled={pending}
            onClick={() => onToggle(group, !enabled)}
          />
        )}
      </div>
    </article>
  );
}
