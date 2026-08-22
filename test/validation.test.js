const test = require('node:test');
const assert = require('node:assert/strict');
const { groupInput, settingsInput } = require('../dist/validation');

test('settingsInput accepts complete server and FCM settings', () => {
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
  });
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

test('groupInput prevents a switch from being in two groups', () => {
  const profile = {
    id: 'server',
    name: 'Server',
    server: {},
    devices: [{ entityId: '1', name: 'Door', type: 'switch' }],
    groups: [{ id: 'existing', name: 'Existing', deviceIds: ['1'] }],
  };

  assert.deepEqual(groupInput({ name: 'Duplicate', deviceIds: ['1'] }, profile), {
    error: 'A switch can belong to only one group.',
  });
  assert.deepEqual(groupInput({ name: 'Existing', deviceIds: ['1'] }, profile, 'existing'), {
    name: 'Existing',
    deviceIds: ['1'],
  });
});
