const test = require('node:test');
const assert = require('node:assert/strict');
const { RustplusControlService } = require('../dist/backend/services/rustplus-control-service');

function createControl() {
  const repository = {
    migrateLegacyFcmConfig() {},
    loadConfig() {
      return {
        activeServerId: 'server',
        servers: [
          {
            id: 'server',
            name: 'Server',
            server: {},
            devices: [
              { entityId: 'switch', name: 'Door', type: 'switch' },
              { entityId: 'alarm', name: 'Alarm', type: 'alarm' },
              { entityId: 'storage', name: 'Storage', type: 'storage' },
            ],
            groups: [
              { id: 'mixed', name: 'Mixed', deviceIds: ['switch', 'alarm', 'storage'] },
              { id: 'alarms', name: 'Alarms', deviceIds: ['alarm'] },
            ],
          },
        ],
      };
    },
    hasFcmConfig() {
      return false;
    },
  };
  const control = new RustplusControlService(repository, process.cwd(), false);
  const commands = [];
  control.client = {
    setEntityValue: (entityId, enabled, callback) => {
      commands.push([entityId, enabled]);
      callback({ response: {} });
    },
  };
  control.status = { connected: true, message: 'Connected' };
  return { control, commands };
}

test('group switch sends commands only to switch devices', async () => {
  const { control, commands } = createControl();

  assert.equal(await control.setGroupValue('mixed', true), null);
  assert.deepEqual(commands, [['switch', true]]);
  assert.equal(await control.setGroupValue('alarms', true), 'no-switches');
});
