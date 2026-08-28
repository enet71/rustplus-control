import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Device, DeviceGroup } from '../../shared/api-types';
import { dashboardState } from '../../test-utils';
import { ControlsPanel } from './controls-panel';
import type { DeviceMutations } from './use-devices';

function fakeMutations(overrides: Partial<DeviceMutations> = {}): DeviceMutations {
  return {
    setDeviceEnabled: { mutate: vi.fn(), isPending: false, variables: undefined },
    setGroupEnabled: { mutate: vi.fn(), isPending: false, variables: undefined },
    renameDevice: { mutate: vi.fn(), isPending: false },
    saveGroup: { mutate: vi.fn(), isPending: false },
    reorderItems: { mutate: vi.fn(), isPending: false },
    isDevicePending: () => false,
    isGroupPending: () => false,
    ...overrides,
  } as unknown as DeviceMutations;
}

function device(entityId: string, type: Device['type'], sortOrder = 0): Device {
  return { entityId, name: `Device ${entityId}`, type, sortOrder };
}

function panel(options: {
  devices: Device[];
  groups?: DeviceGroup[];
  deviceStates?: Record<string, boolean | undefined>;
  mutations?: DeviceMutations;
}) {
  const mutations = options.mutations ?? fakeMutations();
  const base = dashboardState();
  const state = dashboardState({
    deviceStates: options.deviceStates ?? {},
    config: { ...base.config, devices: options.devices, groups: options.groups ?? [] },
  });
  const view = render(
    <ControlsPanel
      key={state.config.activeServerId}
      state={state}
      mutations={mutations}
      onRenameDevice={vi.fn()}
      onEditGroup={vi.fn()}
      onNewGroup={vi.fn()}
      onImport={vi.fn()}
      onExport={vi.fn()}
      importing={false}
      exporting={false}
    />,
  );
  return { view, mutations };
}

describe('ControlsPanel group state', () => {
  const members = [device('sw1', 'switch'), device('sw2', 'switch'), device('alarm', 'alarm')];
  const groups: DeviceGroup[] = [
    { id: 'g1', name: 'Base lights', deviceIds: ['sw1', 'sw2', 'alarm'], sortOrder: 0 },
  ];

  it('shows the group as on when every switch is on, ignoring other device types', () => {
    panel({ devices: members, groups, deviceStates: { sw1: true, sw2: true, alarm: false } });

    expect(
      screen.getByRole('switch', { name: 'Toggle Base lights' }).getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('shows the group as off when one switch is off', () => {
    panel({ devices: members, groups, deviceStates: { sw1: true, sw2: false, alarm: true } });

    expect(
      screen.getByRole('switch', { name: 'Toggle Base lights' }).getAttribute('aria-checked'),
    ).toBe('false');
  });

  it('sends the inverted state for the whole group', async () => {
    const user = userEvent.setup();
    const { mutations } = panel({
      devices: members,
      groups,
      deviceStates: { sw1: true, sw2: true, alarm: false },
    });

    await user.click(screen.getByRole('switch', { name: 'Toggle Base lights' }));

    expect(mutations.setGroupEnabled.mutate).toHaveBeenCalledWith({
      groupId: 'g1',
      enabled: false,
    });
  });

  it('does not render a group toggle when the group holds no switches', () => {
    panel({
      devices: [device('alarm', 'alarm')],
      groups: [{ id: 'g1', name: 'Alarms', deviceIds: ['alarm'], sortOrder: 0 }],
    });

    expect(screen.queryByRole('switch', { name: 'Toggle Alarms' })).toBeNull();
  });

  it('disables a switch while its own request is in flight', () => {
    panel({
      devices: [device('sw1', 'switch')],
      mutations: fakeMutations({ isDevicePending: (id: string) => id === 'sw1' }),
    });

    const toggle = screen.getByRole('switch', { name: 'Toggle Device sw1' });
    expect((toggle as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('ControlsPanel group collapsing', () => {
  const groups: DeviceGroup[] = [
    { id: 'g1', name: 'Base lights', deviceIds: ['sw1'], sortOrder: 0 },
  ];
  const devices = [device('sw1', 'switch')];

  it('hides members when collapsed and keeps the choice after a remount', async () => {
    const user = userEvent.setup();
    const first = panel({ devices, groups });
    expect(screen.queryByText('Device sw1')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'Collapse group' }));
    expect(screen.queryByText('Device sw1')).toBeNull();

    first.view.unmount();
    panel({ devices, groups });

    expect(screen.queryByText('Device sw1')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Collapse group' }).getAttribute('aria-expanded'),
    ).toBe('false');
  });
});

describe('ControlsPanel empty state', () => {
  it('explains how to add the first device', () => {
    panel({ devices: [] });

    expect(screen.queryByText(/Pair a Smart Switch or Smart Alarm/)).not.toBeNull();
  });
});
