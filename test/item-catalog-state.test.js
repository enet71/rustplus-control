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
  control.deviceState.storageStates = {
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

test('deleteDevice removes the device and drops it from any groups, dropping groups left empty', () => {
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
            groups: [
              { id: 'mixed', name: 'Mixed', deviceIds: ['a', 'b'] },
              { id: 'solo', name: 'Solo', deviceIds: ['a'] },
            ],
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

  assert.equal(control.deleteDevice('a'), true);
  assert.equal(control.deleteDevice('missing'), false);

  const state = control.getState();
  assert.deepEqual(
    state.config.devices.map((device) => device.entityId),
    ['b'],
  );
  assert.deepEqual(
    state.config.groups.map((group) => group.id),
    ['mixed'],
  );
  assert.deepEqual(state.config.groups[0].deviceIds, ['b']);
});

test('custom markers can be created, edited and deleted, and survive a profile with none saved', () => {
  const repository = {
    migrateLegacyFcmConfig() {},
    loadConfig() {
      return {
        activeServerId: 'server',
        servers: [{ id: 'server', name: 'Server', server: {}, devices: [], groups: [] }],
      };
    },
    hasFcmConfig() {
      return false;
    },
    saveConfig() {},
  };
  const control = new RustplusControlService(repository, process.cwd(), false);

  assert.deepEqual(control.getState().config.customMarkers, []);

  const marker = control.createCustomMarker('Base', 'Main entrance', 100, 200);
  assert.equal(marker.name, 'Base');
  assert.deepEqual(control.getState().config.customMarkers, [marker]);

  assert.equal(control.updateCustomMarker(marker.id, 'Renamed', 'Updated'), true);
  assert.equal(control.updateCustomMarker('missing', 'x', 'y'), false);
  const updated = control.getState().config.customMarkers[0];
  assert.equal(updated.name, 'Renamed');
  assert.equal(updated.description, 'Updated');
  assert.equal(updated.x, 100);
  assert.equal(updated.y, 200);

  assert.equal(control.deleteCustomMarker(marker.id), true);
  assert.equal(control.deleteCustomMarker(marker.id), false);
  assert.deepEqual(control.getState().config.customMarkers, []);
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
  control.deviceState.storageStates = {
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

  control.deviceState.startStoragePolling(client, [
    { entityId: 'storage', name: 'Locker', type: 'storage' },
  ]);

  assert.equal(control.getState().storageStates.storage.items[0].quantity, 8);
  control.deviceState.stopStoragePolling();
});

test('map markers exclude AppMarkerType.Player entries already covered by team info', () => {
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
    getMapMarkers(callback) {
      callback({
        response: {
          mapMarkers: {
            markers: [
              { id: 1, type: 1, x: 100, y: 100, name: '' },
              { id: 2, type: 5, x: 200, y: 200, name: 'Cargo Ship' },
            ],
          },
        },
      });
    },
  };
  control.client = client;
  control.status = { connected: true, message: 'Connected' };

  control.worldState.startMarkerPolling();

  assert.deepEqual(
    control.getState().mapMarkers.map((marker) => marker.id),
    ['2'],
  );
  control.worldState.stopMarkerPolling();
});

test('team info exposes player-placed map notes, from both the member and the leader', () => {
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
    getTeamInfo(callback) {
      callback({
        response: {
          teamInfo: {
            members: [],
            mapNotes: [{ type: 1, x: 100, y: 150 }],
            leaderMapNotes: [{ type: 2, x: 300, y: 350 }],
          },
        },
      });
    },
  };
  control.client = client;
  control.status = { connected: true, message: 'Connected' };

  control.worldState.startTeamPolling();

  assert.deepEqual(
    control
      .getState()
      .mapNotes.map((note) => ({ type: note.type, x: note.x, y: note.y, source: note.source })),
    [
      { type: 1, x: 100, y: 150, source: 'own' },
      { type: 2, x: 300, y: 350, source: 'leader' },
    ],
  );
  control.worldState.stopTeamPolling();
});

test('team members get Steam avatars fetched and cached for the next poll', async () => {
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
  control.config.steamApiKey = 'test-key';
  const client = {
    getTeamInfo(callback) {
      callback({
        response: {
          teamInfo: {
            members: [{ steamId: '123', name: 'Alice', x: 1, y: 2, isOnline: true }],
          },
        },
      });
    },
  };
  control.client = client;
  control.status = { connected: true, message: 'Connected' };
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      response: { players: [{ steamid: '123', avatarfull: 'https://avatar.example/123.jpg' }] },
    }),
  });

  try {
    control.worldState.startTeamPolling();
    assert.equal(control.getState().teamMapMembers[0].avatarUrl, undefined);

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    control.worldState.startTeamPolling();
    assert.equal(control.getState().teamMapMembers[0].avatarUrl, 'https://avatar.example/123.jpg');
  } finally {
    global.fetch = originalFetch;
    control.worldState.stopTeamPolling();
  }
});

test('keeps only the two most recent death locations per player', () => {
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
  // Rust+ only reports a member's *current* x/y, so a death location is only ever
  // visible for the one poll where it's detected — hence driving the poll cycle
  // by hand here instead of relying on setInterval's real 10s cadence.
  const cycles = [
    { x: 0, y: 0, isAlive: true, deathTime: 0 }, // baseline
    { x: 10, y: 20, isAlive: false, deathTime: 100 }, // death #1
    { x: 50, y: 50, isAlive: true, deathTime: 100 }, // respawn
    { x: 30, y: 40, isAlive: false, deathTime: 200 }, // death #2
    { x: 60, y: 60, isAlive: true, deathTime: 200 }, // respawn
    { x: 70, y: 80, isAlive: false, deathTime: 300 }, // death #3 — should push out death #1
  ];
  let cycleIndex = 0;
  const client = {
    getTeamInfo(callback) {
      const cycle = cycles[cycleIndex];
      cycleIndex += 1;
      callback({
        response: {
          teamInfo: { members: [{ steamId: '1', name: 'Alice', ...cycle }] },
        },
      });
    },
  };
  control.client = client;
  control.status = { connected: true, message: 'Connected' };
  const intervals = [];
  const originalSetInterval = global.setInterval;
  global.setInterval = (callback) => {
    intervals.push(callback);
    return {};
  };

  try {
    control.worldState.startTeamPolling();
    intervals[0]();
    intervals[0]();
    intervals[0]();
    intervals[0]();
    intervals[0]();

    assert.deepEqual(
      control.getState().deathMarkers.map((marker) => ({ x: marker.x, y: marker.y })),
      [
        { x: 70, y: 80 },
        { x: 30, y: 40 },
      ],
    );
  } finally {
    global.setInterval = originalSetInterval;
    control.worldState.stopTeamPolling();
  }
});

test('player-death events include the grid square the death happened in', () => {
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
  control.worldState.map = {
    mapSize: 300,
    width: 2000,
    height: 2000,
    oceanMargin: 250,
    image: 'map.png',
    monuments: [],
  };
  const cycles = [
    { x: 0, y: 0, isAlive: true, deathTime: 0 },
    { x: 10, y: 20, isAlive: false, deathTime: 100 }, // column 0 (x<150), row: (300-20)/150 -> row index 1 -> "A2"
  ];
  let cycleIndex = 0;
  control.client = {
    getTeamInfo(callback) {
      const cycle = cycles[cycleIndex];
      cycleIndex += 1;
      callback({
        response: { teamInfo: { members: [{ steamId: '1', name: 'Alice', ...cycle }] } },
      });
    },
  };
  control.status = { connected: true, message: 'Connected' };
  const written = [];
  control.subscribeEvents({ write: (chunk) => written.push(chunk) });
  const intervals = [];
  const originalSetInterval = global.setInterval;
  global.setInterval = (callback) => {
    intervals.push(callback);
    return {};
  };

  try {
    control.worldState.startTeamPolling();
    intervals[0]();

    const deathEvent = written
      .map((chunk) => JSON.parse(chunk.slice(chunk.indexOf('data: ') + 'data: '.length)))
      .find((event) => event.type === 'player-death');
    assert.equal(deathEvent.body, 'Alice died in A2');
  } finally {
    global.setInterval = originalSetInterval;
    control.worldState.stopTeamPolling();
  }
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
    control.deviceState.loadDeviceStates(client, [
      { entityId: 'switch', name: 'Switch', type: 'switch' },
    ]);
    callbacks[0]({ response: { error: { error: 'rate_limit' } } });

    assert.deepEqual(requestedIds, ['switch']);
    assert.equal(timers[0].delay, 5000);

    timers[0].callback();
    assert.deepEqual(requestedIds, ['switch', 'switch']);
  } finally {
    control.deviceState.stopDeviceStateLoading();
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
            monuments: [
              { token: 'trainyard_display_name', x: 1200, y: 800 },
              { token: '', x: 10, y: 10 },
              { token: 'no_coords' },
              {
                token:
                  'assets/bundled/prefabs/autospawn/underwater-lab-base/module_900x900_2way_moonpool.prefab',
                x: 900,
                y: 900,
              },
            ],
          },
        },
      });
    },
  };
  control.client = client;

  control.worldState.loadMap(client);

  assert.deepEqual(control.getMap(), {
    width: 4500,
    height: 4500,
    oceanMargin: 100,
    mapSize: 4000,
    image: 'data:image/jpeg;base64,bWFwLWltYWdl',
    monuments: [{ token: 'trainyard_display_name', x: 1200, y: 800 }],
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
    control.worldState.loadMap(client);

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
      monuments: [],
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
  control.worldState.loadMap = () => calls.push('map');
  control.worldState.startMarkerPolling = () => calls.push('markers');
  control.worldState.startTeamPolling = () => calls.push('team');
  control.teamChat.startTeamChatPolling = () => calls.push('chat');
  control.deviceState.startStoragePolling = () => calls.push('storage');
  control.deviceState.loadDeviceStates = () => calls.push('controls');

  control.startPollingListeners(client, []);
  control.deviceState.loadDeviceStates(client, []);

  assert.deepEqual(calls, ['map', 'markers', 'team', 'chat', 'storage', 'controls']);
});
