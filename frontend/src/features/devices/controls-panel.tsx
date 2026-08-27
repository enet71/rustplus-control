import { useState } from 'react';
import type { DashboardState, Device, DeviceGroup } from '../../shared/api-types';
import { readCollapsedGroups, writeCollapsedGroups } from './collapsed-groups';
import { groupSwitches, isGroupEnabled, orderControlItems } from './control-items';
import { DeviceRow } from './device-row';
import { GroupRow } from './group-row';
import type { DeviceMutations, MoveDirection } from './use-devices';

type ControlsPanelProps = {
  state: DashboardState;
  mutations: DeviceMutations;
  onRenameDevice: (device: Device) => void;
  onEditGroup: (group: DeviceGroup) => void;
  onNewGroup: () => void;
  onImport: () => void;
  onExport: () => void;
  importing: boolean;
  exporting: boolean;
};

export function ControlsPanel({
  state,
  mutations,
  onRenameDevice,
  onEditGroup,
  onNewGroup,
  onImport,
  onExport,
  importing,
  exporting,
}: ControlsPanelProps) {
  // The caller remounts this panel per server (`key`), so the collapsed set is read
  // once on mount instead of being resynchronised from an effect.
  const serverId = state.config.activeServerId || '';
  const [collapsed, setCollapsed] = useState(() => readCollapsedGroups(serverId));

  const toggleCollapsed = (groupId: string): void =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      writeCollapsedGroups(serverId, next);
      return next;
    });

  const devices = state.config.devices || [];
  const items = orderControlItems(devices, state.config.groups || []);

  const moveDevice = (device: Device, direction: MoveDirection): void => {
    mutations.moveItem.mutate({ type: 'device', id: device.entityId, direction });
  };

  const renderDevice = (device: Device, position: number, count: number, child: boolean) => (
    <DeviceRow
      key={device.entityId}
      device={device}
      enabled={state.deviceStates[device.entityId]}
      storage={state.storageStates?.[device.entityId]}
      child={child}
      position={position}
      count={count}
      pending={mutations.isDevicePending(device.entityId)}
      onToggle={(target, enabled) =>
        mutations.setDeviceEnabled.mutate({ entityId: target.entityId, enabled })
      }
      onRename={onRenameDevice}
      onMove={moveDevice}
    />
  );

  return (
    <section className="controls">
      <div className="row-title">
        <h2>Controls</h2>
        <div className="notification-actions">
          <button className="secondary" onClick={onImport} disabled={importing}>
            Import
          </button>
          <button className="secondary" onClick={onExport} disabled={exporting}>
            Export
          </button>
          <button className="secondary" onClick={onNewGroup} disabled={!devices.length}>
            New group
          </button>
        </div>
      </div>
      <div className="control-list">
        {items.map((item, index) => {
          if (item.kind === 'device') return renderDevice(item.device, index, items.length, false);
          const switches = groupSwitches(item.members);
          const isCollapsed = collapsed.has(item.group.id);
          return (
            <div key={item.group.id}>
              <GroupRow
                group={item.group}
                members={item.members}
                switchCount={switches.length}
                enabled={isGroupEnabled(switches, state.deviceStates)}
                collapsed={isCollapsed}
                position={index}
                count={items.length}
                pending={mutations.isGroupPending(item.group.id)}
                onToggle={(group, enabled) =>
                  mutations.setGroupEnabled.mutate({ groupId: group.id, enabled })
                }
                onToggleCollapsed={toggleCollapsed}
                onEdit={onEditGroup}
                onMove={(group, direction) =>
                  mutations.moveItem.mutate({ type: 'group', id: group.id, direction })
                }
              />
              {!isCollapsed &&
                item.members.map((device, childIndex) =>
                  renderDevice(device, childIndex, item.members.length, true),
                )}
            </div>
          );
        })}
      </div>
      {items.length === 0 && (
        <p className="empty">Pair a Smart Switch or Smart Alarm in Rust to add it here.</p>
      )}
    </section>
  );
}
