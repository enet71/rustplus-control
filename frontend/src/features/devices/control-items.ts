import type { DashboardState, Device, DeviceGroup } from '../../shared/api-types';

export type ControlItem =
  | { kind: 'group'; id: string; sortOrder: number; group: DeviceGroup; members: Device[] }
  | { kind: 'device'; id: string; sortOrder: number; device: Device };

/**
 * Groups and ungrouped devices share one ordering. A device that belongs to a group
 * is rendered under that group instead of at the top level.
 */
export function orderControlItems(devices: Device[], groups: DeviceGroup[]): ControlItem[] {
  const byId = new Map(devices.map((device) => [device.entityId, device]));
  const grouped = new Set(groups.flatMap((group) => group.deviceIds));
  const items: ControlItem[] = [
    ...groups.map((group) => ({
      kind: 'group' as const,
      id: group.id,
      sortOrder: Number(group.sortOrder || 0),
      group,
      members: group.deviceIds
        .map((id) => byId.get(id))
        .filter((device): device is Device => Boolean(device)),
    })),
    ...devices
      .filter((device) => !grouped.has(device.entityId))
      .map((device) => ({
        kind: 'device' as const,
        id: device.entityId,
        sortOrder: Number(device.sortOrder || 0),
        device,
      })),
  ];
  return items.sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Devices selectable for a group: ungrouped devices, plus the group's own current
 * members when editing (so they stay visible to remove). The backend rejects a
 * device already claimed by another group, so exclude those here too.
 */
export function availableGroupDevices(
  devices: Device[],
  groups: DeviceGroup[],
  currentGroupId: string | null,
): Device[] {
  const groupedElsewhere = new Set(
    groups.filter((group) => group.id !== currentGroupId).flatMap((group) => group.deviceIds),
  );
  return devices.filter((device) => !groupedElsewhere.has(device.entityId));
}

export function groupSwitches(members: Device[]): Device[] {
  return members.filter((device) => device.type === 'switch');
}

/** A group reads as on only when every switch in it is on; other device types are ignored. */
export function isGroupEnabled(
  switches: Device[],
  deviceStates: DashboardState['deviceStates'],
): boolean {
  return switches.length > 0 && switches.every((device) => deviceStates[device.entityId] === true);
}
