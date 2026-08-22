const test = require('node:test');
const assert = require('node:assert/strict');
const { RustplusControlService } = require('../dist/services/rustplus-control-service');

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
            ],
            groups: [
              { id: 'mixed', name: 'Mixed', deviceIds: ['switch', 'alarm'] },
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

test('group switch sends commands only to switch devices', () => {
  const { control, commands } = createControl();

  assert.equal(control.setGroupValue('mixed', true), null);
  assert.deepEqual(commands, [['switch', true]]);
  assert.equal(control.setGroupValue('alarms', true), 'no-switches');
});
