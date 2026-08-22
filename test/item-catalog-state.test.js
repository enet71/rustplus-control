const test = require('node:test');
const assert = require('node:assert/strict');
const { RustplusControlService } = require('../dist/services/rustplus-control-service');

test('state uses catalog icons for devices and storage items', () => {
  const catalogItem = {
    id: -123,
    shortName: 'test.item',
    displayName: 'Test Item',
    iconUrl: 'https://cdn.rusthelp.com/images/public/test.item.png',
  };
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
            devices: [{ entityId: 'storage', name: 'Locker', type: 'storage' }],
            groups: [],
          },
        ],
      };
    },
    hasFcmConfig() {
      return false;
    },
  };
  const catalog = {
    get: (id) => (id === -123 ? catalogItem : null),
    getDeviceIcon: () => catalogItem,
  };
  const control = new RustplusControlService(repository, process.cwd(), false, catalog);
  control.storageStates = {
    storage: { capacity: 12, items: [{ itemId: -123, quantity: 5, itemIsBlueprint: false }] },
  };

  const state = control.getState();
  assert.equal(state.config.devices[0].iconUrl, catalogItem.iconUrl);
  assert.deepEqual(state.storageStates.storage.items[0].item, catalogItem);
});
