import { useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { ChevronsDownUp, ChevronsUpDown, Download, Plus, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog';
import type { DashboardState, Device, DeviceGroup } from '../../shared/api-types';
import { readCollapsedGroups, writeCollapsedGroups } from './collapsed-groups';
import { groupSwitches, isGroupEnabled, orderControlItems } from './control-items';
import { DeviceRow } from './device-row';
import { GroupRow } from './group-row';
import type { DeviceMutations, OrderEntry } from './use-devices';

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
  const [pendingDelete, setPendingDelete] = useState<
    { kind: 'device'; device: Device } | { kind: 'group'; group: DeviceGroup } | null
  >(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const toggleCollapsed = (groupId: string): void =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      writeCollapsedGroups(serverId, next);
      return next;
    });

  const devices = state.config.devices || [];
  const groups = state.config.groups || [];
  const groupIds = groups.map((group) => group.id);
  const items = orderControlItems(devices, groups);
  const topLevelIds = items.map((item) => item.id);

  const expandAll = (): void =>
    setCollapsed(() => {
      const next = new Set<string>();
      writeCollapsedGroups(serverId, next);
      return next;
    });

  const collapseAll = (): void =>
    setCollapsed(() => {
      const next = new Set(groupIds);
      writeCollapsedGroups(serverId, next);
      return next;
    });

  const renderDevice = (device: Device, child: boolean) => (
    <DeviceRow
      key={device.entityId}
      device={device}
      enabled={state.deviceStates[device.entityId]}
      storage={state.storageStates?.[device.entityId]}
      child={child}
      pending={mutations.isDevicePending(device.entityId)}
      onToggle={(target, enabled) =>
        mutations.setDeviceEnabled.mutate({ entityId: target.entityId, enabled })
      }
      onRename={onRenameDevice}
      onDelete={(target) => setPendingDelete({ kind: 'device', device: target })}
    />
  );

  const confirmDelete = async (): Promise<void> => {
    if (!pendingDelete) return;
    try {
      if (pendingDelete.kind === 'device')
        await mutations.deleteDevice.mutateAsync(pendingDelete.device.entityId);
      else await mutations.deleteGroup.mutateAsync(pendingDelete.group.id);
      setPendingDelete(null);
    } catch {
      // The mutation reports the failure; the dialog stays open for another attempt.
    }
  };

  const handleTopLevelDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = topLevelIds.indexOf(String(active.id));
    const newIndex = topLevelIds.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const orderedIds = arrayMove(topLevelIds, oldIndex, newIndex);
    const kindById = new Map(items.map((item) => [item.id, item.kind]));
    const order: OrderEntry[] = orderedIds.map((id) => ({
      type: kindById.get(id) === 'group' ? 'group' : 'device',
      id,
    }));
    mutations.reorderItems.mutate(order);
  };

  const handleGroupDragEnd =
    (group: DeviceGroup, memberIds: string[]) =>
    (event: DragEndEvent): void => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = memberIds.indexOf(String(active.id));
      const newIndex = memberIds.indexOf(String(over.id));
      if (oldIndex < 0 || newIndex < 0) return;
      mutations.saveGroup.mutate({
        id: group.id,
        name: group.name,
        deviceIds: arrayMove(memberIds, oldIndex, newIndex),
      });
    };

  return (
    <section>
      <div className="sticky top-0 z-10 flex items-center justify-end gap-2 bg-background pt-8 pb-3">
        <Button variant="secondary" onClick={onImport} disabled={importing}>
          <Upload /> Import
        </Button>
        <Button variant="secondary" onClick={onExport} disabled={exporting}>
          <Download /> Export
        </Button>
        <Button variant="secondary" onClick={onNewGroup} disabled={!devices.length}>
          <Plus /> New group
        </Button>
        <Button
          variant="secondary"
          size="icon"
          onClick={expandAll}
          disabled={!groupIds.length || collapsed.size === 0}
          aria-label="Expand all groups"
        >
          <ChevronsUpDown />
        </Button>
        <Button
          variant="secondary"
          size="icon"
          onClick={collapseAll}
          disabled={!groupIds.length || collapsed.size === groupIds.length}
          aria-label="Collapse all groups"
        >
          <ChevronsDownUp />
        </Button>
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleTopLevelDragEnd}
      >
        <SortableContext items={topLevelIds} strategy={verticalListSortingStrategy}>
          <div className="mt-3 grid gap-2.5">
            {items.map((item) => {
              if (item.kind === 'device') return renderDevice(item.device, false);
              const switches = groupSwitches(item.members);
              const isCollapsed = collapsed.has(item.group.id);
              const memberIds = item.members.map((device) => device.entityId);
              return (
                <div key={item.group.id} className="grid gap-2.5">
                  <GroupRow
                    group={item.group}
                    members={item.members}
                    switchCount={switches.length}
                    enabled={isGroupEnabled(switches, state.deviceStates)}
                    collapsed={isCollapsed}
                    pending={mutations.isGroupPending(item.group.id)}
                    onToggle={(group, enabled) =>
                      mutations.setGroupEnabled.mutate({ groupId: group.id, enabled })
                    }
                    onToggleCollapsed={toggleCollapsed}
                    onEdit={onEditGroup}
                    onDelete={(target) => setPendingDelete({ kind: 'group', group: target })}
                  />
                  {!isCollapsed && (
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      onDragEnd={handleGroupDragEnd(item.group, memberIds)}
                    >
                      <SortableContext items={memberIds} strategy={verticalListSortingStrategy}>
                        {item.members.map((device) => renderDevice(device, true))}
                      </SortableContext>
                    </DndContext>
                  )}
                </div>
              );
            })}
          </div>
        </SortableContext>
      </DndContext>
      {items.length === 0 && (
        <p className="mt-6 text-sm text-muted-foreground">
          Pair a Smart Switch or Smart Alarm in Rust to add it here.
        </p>
      )}
      {pendingDelete && (
        <ConfirmDialog
          title={pendingDelete.kind === 'device' ? 'Delete device?' : 'Delete group?'}
          description={
            pendingDelete.kind === 'device'
              ? `Remove "${pendingDelete.device.name}"? You can pair it again later if needed.`
              : `Delete the group "${pendingDelete.group.name}"? Its devices won't be removed.`
          }
          pending={
            pendingDelete.kind === 'device'
              ? mutations.deleteDevice.isPending
              : mutations.deleteGroup.isPending
          }
          onConfirm={() => void confirmDelete()}
          close={() => setPendingDelete(null)}
        />
      )}
    </section>
  );
}
