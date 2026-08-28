const test = require('node:test');
const assert = require('node:assert/strict');
const {
  deviceBackupInput,
  groupInput,
  reorderInput,
  settingsInput,
} = require('../dist/backend/validation');

test('settingsInput accepts complete server, FCM and Steam settings', () => {
  const result = settingsInput({
    server: {
      name: 'Main',
      host: '127.0.0.1',
      port: '28082',
      playerId: '76561198000000000',
      playerToken: 'player-token',
      useProxy: true,
    },
    fcm: {
      androidId: 'android',
      securityToken: 'security',
      token: 'fcm',
      expoPushToken: 'expo',
      rustplusAuthToken: 'rustplus',
    },
    steamApiKey: 'abc123',
  });

  assert.deepEqual(result, {
    server: {
      name: 'Main',
      host: '127.0.0.1',
      port: '28082',
      playerId: '76561198000000000',
      playerToken: 'player-token',
      useProxy: true,
    },
    fcm: {
      fcm_credentials: {
        gcm: { androidId: 'android', securityToken: 'security' },
        fcm: { token: 'fcm' },
      },
      expo_push_token: 'expo',
      rustplus_auth_token: 'rustplus',
    },
    steamApiKey: 'abc123',
  });
});

test('settingsInput rejects an overlong Steam API key', () => {
  const result = settingsInput({
    server: {
      name: 'Main',
      host: '127.0.0.1',
      port: '28082',
      playerId: '76561198000000000',
      playerToken: 'player-token',
    },
    fcm: {
      androidId: 'android',
      securityToken: 'security',
      token: 'fcm',
      expoPushToken: 'expo',
      rustplusAuthToken: 'rustplus',
    },
    steamApiKey: 'x'.repeat(65),
  });

  assert.deepEqual(result, { error: 'Steam API key must be at most 64 characters.' });
});

test('settingsInput rejects invalid Rust+ port', () => {
  const result = settingsInput({
    server: {
      name: 'Main',
      host: '127.0.0.1',
      port: '70000',
      playerId: '76561198000000000',
      playerToken: 'player-token',
    },
    fcm: {
      androidId: 'android',
      securityToken: 'security',
      token: 'fcm',
      expoPushToken: 'expo',
      rustplusAuthToken: 'rustplus',
    },
  });

  assert.deepEqual(result, { error: 'Port must be between 1 and 65535.' });
});

test('groupInput accepts all device types and prevents duplicate membership', () => {
  const profile = {
    id: 'server',
    name: 'Server',
    server: {},
    devices: [
      { entityId: '1', name: 'Door', type: 'switch' },
      { entityId: '2', name: 'Alarm', type: 'alarm' },
    ],
    groups: [{ id: 'existing', name: 'Existing', deviceIds: ['1'] }],
  };

  assert.deepEqual(groupInput({ name: 'Duplicate', deviceIds: ['1'] }, profile), {
    error: 'A device can belong to only one group.',
  });
  assert.deepEqual(groupInput({ name: 'Existing', deviceIds: ['1'] }, profile, 'existing'), {
    name: 'Existing',
    deviceIds: ['1'],
  });
  assert.deepEqual(groupInput({ name: 'Alarms', deviceIds: ['2'] }, profile), {
    name: 'Alarms',
    deviceIds: ['2'],
  });
});

test('reorderInput accepts a permutation of the current top-level items only', () => {
  const profile = {
    id: 'server',
    name: 'Server',
    server: {},
    devices: [
      { entityId: '1', name: 'Door', type: 'switch' },
      { entityId: '2', name: 'Grouped', type: 'switch' },
      { entityId: '3', name: 'Ungrouped', type: 'alarm' },
    ],
    groups: [{ id: 'g1', name: 'Base', deviceIds: ['2'] }],
  };

  assert.deepEqual(
    reorderInput(
      {
        order: [
          { type: 'device', id: '3' },
          { type: 'group', id: 'g1' },
          { type: 'device', id: '1' },
        ],
      },
      profile,
    ),
    [
      { type: 'device', id: '3' },
      { type: 'group', id: 'g1' },
      { type: 'device', id: '1' },
    ],
  );
  assert.deepEqual(
    reorderInput(
      {
        order: [
          { type: 'group', id: 'g1' },
          { type: 'device', id: '1' },
        ],
      },
      profile,
    ),
    { error: 'order must contain exactly the current top-level items.' },
  );
  assert.deepEqual(
    reorderInput(
      {
        order: [
          { type: 'device', id: '2' },
          { type: 'group', id: 'g1' },
          { type: 'device', id: '1' },
        ],
      },
      profile,
    ),
    { error: 'order must contain exactly the current top-level items.' },
  );
});

test('deviceBackupInput accepts groups and rejects repeated membership', () => {
  const backup = {
    version: 1,
    devices: [
      { entityId: '1', name: 'Door', type: 'switch' },
      { entityId: '2', name: 'Alarm', type: 'alarm' },
      { entityId: '3', name: 'Storage', type: 'storage' },
    ],
    groups: [{ id: 'mixed', name: 'Base', deviceIds: ['1', '2'] }],
  };

  assert.deepEqual(deviceBackupInput(backup), {
    version: 1,
    devices: [
      { entityId: '1', name: 'Door', type: 'switch', sortOrder: 0 },
      { entityId: '2', name: 'Alarm', type: 'alarm', sortOrder: 1 },
      { entityId: '3', name: 'Storage', type: 'storage', sortOrder: 2 },
    ],
    groups: [{ id: 'mixed', name: 'Base', deviceIds: ['1', '2'], sortOrder: 0 }],
  });
  backup.groups.push({ id: 'second', name: 'Duplicate', deviceIds: ['1'] });
  assert.deepEqual(deviceBackupInput(backup), {
    error: 'A backup device can belong to only one group.',
  });
});
