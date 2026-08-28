const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { RustplusControlService } = require('../dist/backend/services/rustplus-control-service');

test('Rust+ protobuf patch makes AppInfo queuedPlayers optional', () => {
  const proto = fs.readFileSync(
    path.join(process.cwd(), 'node_modules', '@liamcottle', 'rustplus.js', 'rustplus.proto'),
    'utf8',
  );
  assert.match(proto, /message AppInfo \{[\s\S]*?optional uint32 queuedPlayers = 9;/);
});

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

test('reorderTopLevel assigns sortOrder from the given order', () => {
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
              { entityId: 'a', name: 'A', type: 'switch' },
              { entityId: 'b', name: 'B', type: 'switch' },
            ],
            groups: [{ id: 'g1', name: 'Group', deviceIds: ['a'] }],
          },
        ],
      };
    },
    hasFcmConfig() {
      return false;
    },
    saveConfig() {},
  };
  const control = new RustplusControlService(repository, process.cwd(), false);

  const ok = control.reorderTopLevel([
    { type: 'device', id: 'b' },
    { type: 'group', id: 'g1' },
  ]);

  assert.equal(ok, true);
  const state = control.getState();
  assert.equal(state.config.devices.find((device) => device.entityId === 'b').sortOrder, 0);
  assert.equal(state.config.groups.find((group) => group.id === 'g1').sortOrder, 1);
});

test('storage monitor refreshes after a pipe change pulse without items', () => {
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
  const control = new RustplusControlService(repository, process.cwd(), false);
  control.storageStates = {
    storage: { capacity: 12, items: [{ itemId: 1, quantity: 3, itemIsBlueprint: false }] },
  };
  const client = {
    getEntityInfo(entityId, callback) {
      assert.equal(entityId, 'storage');
      callback({
        response: {
          entityInfo: {
            payload: {
              capacity: 12,
              items: [{ itemId: 1, quantity: 8, itemIsBlueprint: false }],
            },
          },
        },
      });
    },
  };
  control.client = client;

  control.handleEntityChanged(client, {
    broadcast: { entityChanged: { entityId: 'storage', payload: { value: false } } },
  });

  assert.equal(control.getState().storageStates.storage.items[0].quantity, 8);
});

test('storage monitors are polled when broadcasts are absent', () => {
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
  const control = new RustplusControlService(repository, process.cwd(), false);
  const client = {
    getEntityInfo(_entityId, callback) {
      callback({
        response: {
          entityInfo: {
            payload: {
              capacity: 12,
              items: [{ itemId: 1, quantity: 8, itemIsBlueprint: false }],
            },
          },
        },
      });
    },
  };
  control.client = client;
  control.status = { connected: true, message: 'Connected' };

  control.startStoragePolling(client, [{ entityId: 'storage', name: 'Locker', type: 'storage' }]);

  assert.equal(control.getState().storageStates.storage.items[0].quantity, 8);
  control.stopStoragePolling();
});

test('device state loading retries the same device after a Rust+ rate limit', () => {
  const repository = {
    migrateLegacyFcmConfig() {},
    loadConfig() {
      return { activeServerId: 'server', servers: [] };
    },
    hasFcmConfig() {
      return false;
    },
  };
  const control = new RustplusControlService(repository, process.cwd(), false);
  const callbacks = [];
  const requestedIds = [];
  const timers = [];
  const setTimeoutOriginal = global.setTimeout;
  const client = {
    getEntityInfo(entityId, callback) {
      requestedIds.push(entityId);
      callbacks.push(callback);
    },
  };
  global.setTimeout = (callback, delay) => {
    timers.push({ callback, delay });
    return {};
  };
  control.client = client;
  control.status = { connected: true, message: 'Connected' };

  try {
    control.loadDeviceStates(client, [{ entityId: 'switch', name: 'Switch', type: 'switch' }]);
    callbacks[0]({ response: { error: { error: 'rate_limit' } } });

    assert.deepEqual(requestedIds, ['switch']);
    assert.equal(timers[0].delay, 5000);

    timers[0].callback();
    assert.deepEqual(requestedIds, ['switch', 'switch']);
  } finally {
    control.stopDeviceStateLoading();
    global.setTimeout = setTimeoutOriginal;
  }
});

test('Rust+ map image is exposed with its coordinate metadata', () => {
  const repository = {
    migrateLegacyFcmConfig() {},
    loadConfig() {
      return { activeServerId: 'server', servers: [] };
    },
    hasFcmConfig() {
      return false;
    },
  };
  const control = new RustplusControlService(repository, process.cwd(), false);
  const client = {
    getInfo(callback) {
      callback({ response: { info: { mapSize: 4000 } } });
    },
    getMap(callback) {
      callback({
        response: {
          map: {
            width: 4500,
            height: 4500,
            oceanMargin: 100,
            jpgImage: Buffer.from('map-image'),
          },
        },
      });
    },
  };
  control.client = client;

  control.loadMap(client);

  assert.deepEqual(control.getMap(), {
    width: 4500,
    height: 4500,
    oceanMargin: 100,
    mapSize: 4000,
    image: 'data:image/jpeg;base64,bWFwLWltYWdl',
  });
});

test('map loading retries after a Rust+ rate limit instead of giving up', () => {
  const repository = {
    migrateLegacyFcmConfig() {},
    loadConfig() {
      return { activeServerId: 'server', servers: [] };
    },
    hasFcmConfig() {
      return false;
    },
  };
  const control = new RustplusControlService(repository, process.cwd(), false);
  const timers = [];
  const setTimeoutOriginal = global.setTimeout;
  global.setTimeout = (callback, delay) => {
    timers.push({ callback, delay });
    return {};
  };
  let getInfoCalls = 0;
  const client = {
    getInfo(callback) {
      getInfoCalls += 1;
      if (getInfoCalls === 1) {
        callback({ response: { error: { error: 'rate_limit' } } });
      } else {
        callback({ response: { info: { mapSize: 4000 } } });
      }
    },
    getMap(callback) {
      callback({
        response: {
          map: {
            width: 4500,
            height: 4500,
            oceanMargin: 100,
            jpgImage: Buffer.from('map-image'),
          },
        },
      });
    },
  };
  control.client = client;

  try {
    control.loadMap(client);

    assert.equal(getInfoCalls, 1);
    assert.equal(control.getMap(), null);
    assert.equal(timers[0].delay, 5000);

    timers[0].callback();

    assert.equal(getInfoCalls, 2);
    assert.deepEqual(control.getMap(), {
      width: 4500,
      height: 4500,
      oceanMargin: 100,
      mapSize: 4000,
      image: 'data:image/jpeg;base64,bWFwLWltYWdl',
    });
  } finally {
    global.setTimeout = setTimeoutOriginal;
  }
});

test('polling listeners start before the device state queue', () => {
  const repository = {
    migrateLegacyFcmConfig() {},
    loadConfig() {
      return { activeServerId: 'server', servers: [] };
    },
    hasFcmConfig() {
      return false;
    },
  };
  const control = new RustplusControlService(repository, process.cwd(), false);
  const calls = [];
  const client = {};
  control.loadMap = () => calls.push('map');
  control.startMarkerPolling = () => calls.push('markers');
  control.startTeamPolling = () => calls.push('team');
  control.startTeamChatPolling = () => calls.push('chat');
  control.startStoragePolling = () => calls.push('storage');
  control.loadDeviceStates = () => calls.push('controls');

  control.startPollingListeners(client, []);
  control.loadDeviceStates(client, []);

  assert.deepEqual(calls, ['map', 'markers', 'team', 'chat', 'storage', 'controls']);
});
