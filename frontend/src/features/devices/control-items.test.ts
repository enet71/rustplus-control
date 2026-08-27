import { describe, expect, it } from 'vitest';
import type { Device, DeviceGroup } from '../../shared/api-types';
import { groupSwitches, isGroupEnabled, orderControlItems } from './control-items';

function device(entityId: string, type: Device['type'], sortOrder?: number): Device {
  return { entityId, name: `Device ${entityId}`, type, sortOrder };
}

function group(id: string, deviceIds: string[], sortOrder?: number): DeviceGroup {
  return { id, name: `Group ${id}`, deviceIds, sortOrder };
}

describe('orderControlItems', () => {
  it('keeps grouped devices out of the top level and sorts groups with devices', () => {
    const devices = [device('a', 'switch', 3), device('b', 'switch', 1), device('c', 'alarm', 4)];
    const groups = [group('g1', ['b'], 2)];

    const items = orderControlItems(devices, groups);

    expect(items.map((item) => item.id)).toEqual(['g1', 'a', 'c']);
    expect(items[0]).toMatchObject({ kind: 'group' });
    expect(items[0].kind === 'group' && items[0].members.map((member) => member.entityId)).toEqual([
      'b',
    ]);
  });

  it('ignores group members that no longer exist', () => {
    const items = orderControlItems([device('a', 'switch')], [group('g1', ['a', 'missing'])]);

    expect(items[0].kind === 'group' && items[0].members.map((member) => member.entityId)).toEqual([
      'a',
    ]);
  });

  it('treats a missing sortOrder as zero rather than dropping the item', () => {
    const items = orderControlItems([device('a', 'switch'), device('b', 'switch', -1)], []);

    expect(items.map((item) => item.id)).toEqual(['b', 'a']);
  });
});

describe('isGroupEnabled', () => {
  const switches = [device('a', 'switch'), device('b', 'switch')];

  it('is on only when every switch is on', () => {
    expect(isGroupEnabled(switches, { a: true, b: true })).toBe(true);
    expect(isGroupEnabled(switches, { a: true, b: false })).toBe(false);
    expect(isGroupEnabled(switches, { a: true })).toBe(false);
  });

  it('is off for a group without switches', () => {
    expect(isGroupEnabled([], { a: true })).toBe(false);
  });

  it('ignores alarms and storage monitors when deciding the group state', () => {
    const members = [device('a', 'switch'), device('alarm', 'alarm'), device('box', 'storage')];

    expect(groupSwitches(members).map((member) => member.entityId)).toEqual(['a']);
    expect(isGroupEnabled(groupSwitches(members), { a: true, alarm: false })).toBe(true);
  });
});
