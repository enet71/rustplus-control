const test = require('node:test');
const assert = require('node:assert/strict');
const { RustplusControlService } = require('../dist/backend/services/rustplus-control-service');

function createControl() {
  const control = new RustplusControlService(
    {
      migrateLegacyFcmConfig() {},
      loadConfig() {
        return {
          activeServerId: 'server',
          servers: [
            {
              id: 'server',
              name: 'Server',
              server: {},
              devices: [{ entityId: 'sw1', name: 'SW1', type: 'switch' }],
              groups: [{ id: 'base', name: 'Base', deviceIds: ['sw1'] }],
            },
          ],
        };
      },
      hasFcmConfig() {
        return false;
      },
      deleteFcmConfigs() {},
    },
    process.cwd(),
    false,
  );
  const replies = [];
  const commands = [];
  const client = {
    getEntityInfo(_entityId, callback) {
      callback({ response: { entityInfo: { payload: { value: true } } } });
    },
    setEntityValue(entityId, enabled, callback) {
      commands.push([entityId, enabled]);
      callback({ response: {} });
    },
    sendTeamMessage(message) {
      replies.push(message);
    },
    disconnect() {},
  };
  control.client = client;
  control.status = { connected: true, message: 'Connected' };
  return { control, client, replies, commands };
}

test('team chat commands query and control switches and groups', async () => {
  const { control, client, replies, commands } = createControl();

  await control.sendChatTargetState(client, { name: 'SW1', switchIds: ['sw1'], isGroup: false });
  await control.setChatTargetValue(
    client,
    { name: 'SW1', switchIds: ['sw1'], isGroup: false },
    true,
  );
  await control.setChatTargetValue(
    client,
    { name: 'Base', switchIds: ['sw1'], isGroup: true },
    false,
  );

  assert.deepEqual(replies, [
    '[rust-control] SW1: on.',
    '[rust-control] SW1: on.',
    '[rust-control] Group Base: off.',
  ]);
  assert.deepEqual(commands, [
    ['sw1', true],
    ['sw1', false],
  ]);
});

test('team chat ignores messages that are not commands and reports unknown targets', () => {
  const { control, client, replies } = createControl();

  control.handleTeamChatMessage(client, { steamId: '1', time: 1, message: 'sw1+' });
  control.handleTeamChatMessage(client, { steamId: '1', time: 2, message: '!missing' });

  assert.deepEqual(replies, ['[rust-control] Switch or group not found: missing.']);
});

test('team chat reports switches that failed in a partial group command', async () => {
  const { control, client, replies, commands } = createControl();

  client.setEntityValue = (entityId, enabled, callback) => {
    commands.push([entityId, enabled]);
    callback(
      entityId === 'sw2' ? { response: { error: { error: 'rejected' } } } : { response: {} },
    );
  };
  await control.setChatTargetValue(
    client,
    { name: 'Base', switchIds: ['sw1', 'sw2'], isGroup: true },
    true,
  );

  assert.deepEqual(commands, [
    ['sw1', true],
    ['sw2', true],
  ]);
  assert.deepEqual(replies, ['[rust-control] Group Base: 1/2 switches changed; failed: sw2.']);
});

test('logout stops every polling timer', () => {
  const { control } = createControl();
  control.markerPolling = setInterval(() => {}, 1000);
  control.teamPolling = setInterval(() => {}, 1000);
  control.teamChatPolling = setInterval(() => {}, 1000);

  control.logoutFcm();

  assert.equal(control.markerPolling, null);
  assert.equal(control.teamPolling, null);
  assert.equal(control.teamChatPolling, null);
});

test('team chat polling waits for the previous request to finish', () => {
  const { control, client } = createControl();
  const callbacks = [];
  let poll;
  const setIntervalOriginal = global.setInterval;
  client.sendRequest = (_request, callback) => callbacks.push(callback);
  global.setInterval = (callback) => {
    poll = callback;
    return {};
  };

  try {
    control.startTeamChatPolling(client);
    poll();
    assert.equal(callbacks.length, 1);

    callbacks[0]({ response: { teamChat: { messages: [] } } });
    poll();
    assert.equal(callbacks.length, 2);
  } finally {
    control.stopTeamChatPolling();
    global.setInterval = setIntervalOriginal;
  }
});
