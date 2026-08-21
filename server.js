const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const RustPlus = require('@liamcottle/rustplus.js');

const app = express();
const PORT = Number(process.env.PORT || 3010);
const HOST = process.env.HOST || '127.0.0.1';
const CONFIG_PATH = path.join(__dirname, 'data', 'rustplus.json');
const FCM_CONFIG_PATH = path.join(__dirname, 'data', 'rustplus-fcm.json');
const LEGACY_FCM_CONFIG_PATH = path.join(__dirname, 'rustplus.config.json');
const FCM_CLI_PATH = path.join(__dirname, 'node_modules', '@liamcottle', 'rustplus.js', 'cli', 'index.js');
const FCM_LISTENER_PATH = path.join(__dirname, 'scripts', 'fcm-listen.js');
const API_AUTH_TOKEN = process.env.APP_AUTH_TOKEN;
const RECONNECT_DELAY_MS = 5000;
const FCM_REGISTRATION_AVAILABLE = process.env.NODE_ENV !== 'production';

if (!API_AUTH_TOKEN) throw new Error('APP_AUTH_TOKEN must be set before starting Rust+ Control.');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', (request, response, next) => {
  const authorization = request.get('authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : '';
  const expected = Buffer.from(API_AUTH_TOKEN);
  const received = Buffer.from(token);
  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
    return response.status(401).json({ error: 'Authentication required.' });
  }
  response.set('Cache-Control', 'no-store');
  return next();
});

if (!fs.existsSync(FCM_CONFIG_PATH) && fs.existsSync(LEGACY_FCM_CONFIG_PATH)) {
  fs.mkdirSync(path.dirname(FCM_CONFIG_PATH), { recursive: true });
  fs.copyFileSync(LEGACY_FCM_CONFIG_PATH, FCM_CONFIG_PATH);
}

let client = null;
let status = { connected: false, message: 'Not configured' };
let config = loadConfig();
let deviceStates = {};
let markerSnapshots = new Map();
let teamDeaths = new Map();
const eventClients = new Set();
let markerPolling = null;
let teamPolling = null;
let reconnectTimer = null;
let fcmRegisterProcess = null;
let fcmListenerProcess = null;
let fcmStatus = { registered: fs.existsSync(FCM_CONFIG_PATH), listening: false, message: 'Not registered' };
const pendingPairings = new Map();

function loadConfig() {
  try {
    const loaded = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (Array.isArray(loaded.servers)) return { activeServerId: loaded.activeServerId || loaded.servers[0]?.id || null, servers: loaded.servers };
    if (loaded.server?.host) {
      const id = 'legacy-server';
      const migrated = { activeServerId: id, servers: [{ id, name: 'Rust server', server: loaded.server, devices: loaded.devices || [], groups: [] }] };
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(migrated, null, 2), { mode: 0o600 });
      return migrated;
    }
    return { activeServerId: null, servers: [] };
  } catch (error) {
    return { activeServerId: null, servers: [] };
  }
}

function saveConfig(nextConfig) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(nextConfig, null, 2), { mode: 0o600 });
  config = nextConfig;
}

function activeProfile() {
  return config.servers.find((server) => server.id === config.activeServerId) || null;
}

function setActiveProfile(profile) {
  saveConfig({ ...config, activeServerId: profile.id, servers: config.servers.map((item) => item.id === profile.id ? profile : item) });
}

function publicConfig() {
  const profile = activeProfile();
  const { playerToken, ...server } = profile?.server || {};
  return {
    server: { ...server, hasPlayerToken: Boolean(playerToken) },
    devices: profile?.devices || [],
    groups: profile?.groups || [],
    activeServerId: config.activeServerId,
    servers: config.servers.map((item) => ({ id: item.id, name: item.name, host: item.server.host, connected: item.id === config.activeServerId && status.connected })),
  };
}

function groupInput(body, profile, currentGroupId = null) {
  const name = String(body?.name || '').trim();
  const deviceIds = Array.isArray(body?.deviceIds) ? [...new Set(body.deviceIds.map((id) => String(id)))] : null;
  const switchIds = new Set((profile.devices || []).filter((device) => device.type !== 'alarm').map((device) => String(device.entityId)));
  const groupedIds = new Set((profile.groups || []).filter((group) => group.id !== currentGroupId).flatMap((group) => group.deviceIds || []));
  if (!name || name.length > 80) return { error: 'Group name must be between 1 and 80 characters.' };
  if (!deviceIds?.length || deviceIds.some((id) => !switchIds.has(id))) return { error: 'A group must contain one or more known switches.' };
  if (deviceIds.some((id) => groupedIds.has(id))) return { error: 'A switch can belong to only one group.' };
  return { name, deviceIds };
}

function reconcileGroups(groups, devices) {
  const switchIds = new Set(devices.filter((device) => device.type !== 'alarm').map((device) => String(device.entityId)));
  return (groups || []).map((group) => ({ ...group, deviceIds: [...new Set((group.deviceIds || []).map((id) => String(id)).filter((id) => switchIds.has(id)))] })).filter((group) => group.deviceIds.length);
}

function sortOrder(item, fallback) {
  const value = Number(item.sortOrder);
  return Number.isFinite(value) ? value : fallback;
}

function ordered(items) {
  return [...items].sort((left, right) => sortOrder(left.item, left.index) - sortOrder(right.item, right.index));
}

function nextSortOrder(profile) {
  const items = [...(profile.groups || []), ...(profile.devices || [])];
  return Math.max(-1, ...items.map((item, index) => sortOrder(item, index))) + 1;
}

function moveProfileItem(profile, type, id, direction) {
  const devices = profile.devices || [];
  const groups = profile.groups || [];
  const parent = type === 'device' ? groups.find((group) => group.deviceIds.includes(id)) : null;
  const items = parent
    ? parent.deviceIds.map((entityId, index) => ({ item: devices.find((device) => device.entityId === entityId), index })).filter((entry) => entry.item)
    : [...groups.map((item, index) => ({ item, index, type: 'group' })), ...devices.filter((device) => !groups.some((group) => group.deviceIds.includes(device.entityId))).map((item, index) => ({ item, index: groups.length + index, type: 'device' }))];
  const orderedItems = ordered(items);
  const position = orderedItems.findIndex((entry) => entry.item.id === id || entry.item.entityId === id);
  const target = position + direction;
  if (position < 0 || target < 0 || target >= orderedItems.length) return null;
  [orderedItems[position], orderedItems[target]] = [orderedItems[target], orderedItems[position]];
  const orderById = new Map(orderedItems.map((entry, index) => [entry.item.id || entry.item.entityId, index]));
  return {
    ...profile,
    groups: groups.map((group) => orderById.has(group.id) ? { ...group, sortOrder: orderById.get(group.id) } : group),
    devices: devices.map((device) => orderById.has(device.entityId) ? { ...device, sortOrder: orderById.get(device.entityId) } : device),
  };
}

function publishEntityState(entityId, value) {
  deviceStates[String(entityId)] = Boolean(value);
}

function publishEvent(event) {
  const payload = `event: rust-event\ndata: ${JSON.stringify(event)}\n\n`;
  for (const response of eventClients) response.write(payload);
}

function addPairedDevice(pairing) {
  const { entityId, type, name, serverId } = pairing;
  const profile = config.servers.find((item) => item.id === serverId);
  if (!profile) return;
  const devices = profile.devices || [];
  if (!devices.some((device) => device.entityId === entityId)) {
    saveConfig({ ...config, servers: config.servers.map((item) => item.id === profile.id ? { ...profile, devices: [...devices, { name, entityId, type, sortOrder: nextSortOrder(profile) }] } : item) });
  }
}

function handlePairing(data) {
  const bodyValue = data.appData?.find((item) => item.key === 'body')?.value;
  if (!bodyValue) return;
  let pairing;
  try { pairing = JSON.parse(bodyValue); } catch { return; }
  if (pairing.type === 'server') {
    const id = String(pairing.id || `${pairing.ip}:${pairing.port}`);
    const existing = config.servers.find((item) => item.id === id);
    const profile = { id, name: pairing.name || pairing.ip, server: { host: String(pairing.ip), port: String(pairing.port), playerId: String(pairing.playerId), playerToken: String(pairing.playerToken), useProxy: false }, devices: existing?.devices || [], groups: existing?.groups || [] };
    saveConfig({ ...config, activeServerId: id, servers: [...config.servers.filter((item) => item.id !== id), profile] });
    publishEvent({ id: `pair-server:${Date.now()}`, title: 'Rust+ server paired', body: pairing.name || pairing.ip, type: 'pairing', createdAt: new Date().toISOString() });
    connect();
  }
  if (pairing.type === 'entity' && pairing.entityId) {
    const entityId = String(pairing.entityId);
    const serverId = String(pairing.id || config.activeServerId || '');
    const profile = config.servers.find((item) => item.id === serverId);
    if (!profile || (profile.devices || []).some((device) => device.entityId === entityId)) return;
    const pending = { id: `${entityId}:${Date.now()}`, serverId, entityId, name: pairing.entityName || 'Smart device', type: String(pairing.entityType) === '2' ? 'alarm' : 'switch' };
    pendingPairings.set(pending.id, pending);
    publishEvent({ id: pending.id, title: 'New Rust+ device', body: pending.name, type: 'pairing-device', pairingId: pending.id, createdAt: new Date().toISOString() });
  }
}

function startFcmListener() {
  if (fcmListenerProcess) return;
  fcmListenerProcess = spawn(process.execPath, [FCM_LISTENER_PATH, FCM_CONFIG_PATH], { cwd: __dirname });
  fcmStatus = { registered: true, listening: true, message: 'Listening for Rust+ pairing notifications' };
  let buffer = '';
  fcmListenerProcess.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      try { handlePairing(JSON.parse(line)); } catch { /* Ignore non-JSON listener output. */ }
    }
  });
  fcmListenerProcess.stderr.on('data', (chunk) => { fcmStatus.message = `Listener error: ${chunk.toString().trim()}`; });
  fcmListenerProcess.on('close', (code) => {
    fcmListenerProcess = null;
    fcmStatus = { registered: fs.existsSync(FCM_CONFIG_PATH), listening: false, message: `Listener stopped (${code ?? 'unknown'})` };
  });
}

function startFcmRegister() {
  if (fs.existsSync(FCM_CONFIG_PATH)) {
    fcmStatus = { registered: true, listening: Boolean(fcmListenerProcess), message: 'Rust+ is already registered' };
    startFcmListener();
    return;
  }
  if (fcmRegisterProcess) return;
  fcmRegisterProcess = spawn(process.execPath, [FCM_CLI_PATH, `--config-file=${FCM_CONFIG_PATH}`, 'fcm-register'], { cwd: __dirname });
  fcmStatus = { registered: false, listening: false, message: 'Chrome is opening for Steam sign-in' };
  fcmRegisterProcess.stderr.on('data', (chunk) => { fcmStatus.message = `Registration error: ${chunk.toString().trim()}`; });
  fcmRegisterProcess.on('close', (code) => {
    fcmRegisterProcess = null;
    if (code === 0 && fs.existsSync(FCM_CONFIG_PATH)) {
      fcmStatus = { registered: true, listening: false, message: 'Registration complete' };
      startFcmListener();
      connect();
    } else {
      fcmStatus = { registered: false, listening: false, message: `Registration stopped (${code ?? 'unknown'})` };
    }
  });
}

function markerLabel(marker) {
  return ({ 3: 'Vending machine', 4: 'CH47', 5: 'Cargo Ship', 8: 'Patrol Helicopter' })[marker.type] || 'Map event';
}

function startMarkerPolling() {
  clearInterval(markerPolling);
  markerSnapshots = new Map();
  const poll = () => {
    if (!client || !status.connected) return;
    client.getMapMarkers((message) => {
      const markers = message.response?.mapMarkers?.markers;
      if (!Array.isArray(markers)) return true;
      const next = new Map(markers.map((marker) => [String(marker.id), JSON.stringify({ type: marker.type, name: marker.name, outOfStock: marker.outOfStock, sellOrders: marker.sellOrders })]));
      if (markerSnapshots.size) {
        for (const marker of markers) {
          const id = String(marker.id);
          const previous = markerSnapshots.get(id);
          const changedVending = marker.type === 3 && previous && previous !== next.get(id);
          const newEvent = !previous && [3, 4, 5, 8].includes(marker.type);
          if (changedVending || newEvent) {
            publishEvent({ id: `${id}:${Date.now()}`, title: markerLabel(marker), body: changedVending ? `${marker.name || 'Offers'} changed` : 'New event detected on the map', type: marker.type, createdAt: new Date().toISOString() });
          }
        }
      }
      markerSnapshots = next;
      return true;
    });
  };
  poll();
  markerPolling = setInterval(poll, 10000);
}

function startTeamPolling() {
  clearInterval(teamPolling);
  teamDeaths = new Map();
  const poll = () => {
    if (!client || !status.connected) return;
    client.getTeamInfo((message) => {
      const members = message.response?.teamInfo?.members;
      if (!Array.isArray(members)) return true;
      const nextDeaths = new Map(members.map((member) => [String(member.steamId), Number(member.deathTime || 0)]));
      if (teamDeaths.size) {
        for (const member of members) {
          const id = String(member.steamId);
          const previousDeath = teamDeaths.get(id) || 0;
          const deathTime = Number(member.deathTime || 0);
          if (!member.isAlive && deathTime > previousDeath) {
            publishEvent({ id: `${id}:${deathTime}`, title: 'Player death', body: `${member.name} died`, type: 'player-death', createdAt: new Date().toISOString() });
          }
        }
      }
      teamDeaths = nextDeaths;
      return true;
    });
  };
  poll();
  teamPolling = setInterval(poll, 10000);
}

function cancelReconnect() {
  if (!reconnectTimer) return;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  const server = activeProfile()?.server || {};
  if (![server.host, server.port, server.playerId, server.playerToken].every(Boolean)) return;
  status = { connected: false, message: `Disconnected. Retrying in ${RECONNECT_DELAY_MS / 1000} seconds...` };
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, RECONNECT_DELAY_MS);
}

function connect() {
  cancelReconnect();
  if (client) {
    const previousClient = client;
    client = null;
    previousClient.disconnect();
  }
  const profile = activeProfile();
  const server = profile?.server || {};
  if (!server.host || !server.port || !server.playerId || !server.playerToken) {
    status = { connected: false, message: 'Enter Rust+ server credentials' };
    return;
  }

  status = { connected: false, message: 'Connecting...' };
  const rustplus = new RustPlus(server.host, String(server.port), String(server.playerId), String(server.playerToken), Boolean(server.useProxy));
  client = rustplus;
  rustplus.on('connected', () => {
    if (client !== rustplus) return;
    cancelReconnect();
    status = { connected: true, message: 'Connected' };
    for (const device of profile?.devices || []) {
      rustplus.getEntityInfo(String(device.entityId), (message) => {
        const value = message.response && message.response.entityInfo && message.response.entityInfo.payload.value;
        if (typeof value === 'boolean') publishEntityState(device.entityId, value);
        return true;
      });
    }
    startMarkerPolling();
    startTeamPolling();
  });
  rustplus.on('connecting', () => { if (client === rustplus) status = { connected: false, message: 'Connecting...' }; });
  rustplus.on('disconnected', () => {
    if (client !== rustplus) return;
    clearInterval(markerPolling);
    clearInterval(teamPolling);
    scheduleReconnect();
  });
  rustplus.on('error', (error) => {
    if (client !== rustplus) return;
    status = { connected: false, message: `Connection error: ${error.message}` };
    scheduleReconnect();
  });
  rustplus.on('message', (message) => {
    if (client !== rustplus) return;
    const changed = message.broadcast && message.broadcast.entityChanged;
    if (changed && typeof changed.payload.value === 'boolean') {
      const entityId = String(changed.entityId);
      const wasActive = deviceStates[entityId];
      publishEntityState(entityId, changed.payload.value);
      const device = (activeProfile()?.devices || []).find((item) => item.entityId === entityId);
      if (device?.type === 'alarm' && changed.payload.value && !wasActive) {
        publishEvent({ id: `${entityId}:${Date.now()}`, title: 'Smart Alarm', body: `${device.name} was triggered`, type: 'alarm', createdAt: new Date().toISOString() });
      }
    }
  });
  rustplus.connect();
}

app.get('/api/auth/verify', (request, response) => response.json({ authenticated: true }));
app.get('/api/state', (request, response) => response.json({ ...status, config: publicConfig(), deviceStates }));
app.get('/api/fcm/status', (request, response) => response.json({ ...fcmStatus, registrationAvailable: FCM_REGISTRATION_AVAILABLE }));
app.post('/api/fcm/register', (request, response) => {
  if (!FCM_REGISTRATION_AVAILABLE) return response.status(403).json({ error: 'Rust+ registration is available only on a local installation.' });
  startFcmRegister();
  return response.status(202).json({ ok: true });
});
app.post('/api/fcm/logout', (request, response) => {
  cancelReconnect();
  fcmRegisterProcess?.kill();
  fcmListenerProcess?.kill();
  fcmRegisterProcess = null;
  fcmListenerProcess = null;
  for (const file of [FCM_CONFIG_PATH, LEGACY_FCM_CONFIG_PATH]) if (fs.existsSync(file)) fs.unlinkSync(file);
  pendingPairings.clear();
  if (client) client.disconnect();
  client = null;
  deviceStates = {};
  status = { connected: false, message: 'Log in to connect Rust+' };
  fcmStatus = { registered: false, listening: false, message: 'Not registered' };
  response.json({ ok: true });
});
app.get('/api/pairings/pending', (request, response) => response.json([...pendingPairings.values()]));
app.post('/api/pairings/:id/accept', (request, response) => {
  const pairing = pendingPairings.get(request.params.id);
  if (!pairing) return response.status(404).json({ error: 'Pairing request expired.' });
  const name = String(request.body?.name || pairing.name).trim();
  const type = request.body?.type === 'alarm' ? 'alarm' : 'switch';
  if (!name) return response.status(400).json({ error: 'Device name is required.' });
  addPairedDevice({ ...pairing, name, type });
  pendingPairings.delete(pairing.id);
  if (pairing.serverId === config.activeServerId) connect();
  response.json({ ok: true });
});
app.delete('/api/pairings/:id', (request, response) => {
  pendingPairings.delete(request.params.id);
  response.status(204).end();
});
app.post('/api/servers/:id/activate', (request, response) => {
  const profile = config.servers.find((item) => item.id === request.params.id);
  if (!profile) return response.status(404).json({ error: 'Unknown server.' });
  saveConfig({ ...config, activeServerId: profile.id });
  deviceStates = {};
  if (fcmStatus.registered) connect();
  else status = { connected: false, message: 'Log in to connect Rust+' };
  response.json({ ok: true });
});

app.get('/api/events', (request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  response.write(': connected\n\n');
  eventClients.add(response);
  request.on('close', () => eventClients.delete(response));
});

app.put('/api/config', (request, response) => {
  const body = request.body || {};
  const server = body.server || {};
  let profile = activeProfile();
  if (!profile) {
    profile = { id: `manual-${Date.now()}`, name: 'Manual server', server: {}, devices: [], groups: [] };
    saveConfig({ ...config, activeServerId: profile.id, servers: [...config.servers, profile] });
  }
  const playerToken = String(server.playerToken || profile.server.playerToken || '');
  if (![server.host, server.port, server.playerId, playerToken].every(Boolean)) {
    return response.status(400).json({ error: 'host, port, Steam64 ID and pairing token are required.' });
  }
  const devices = body.devices === undefined ? profile.devices || [] : body.devices;
  if (!Array.isArray(devices) || devices.some((device) => !device.name || !/^-?\d+$/.test(String(device.entityId)))) {
    return response.status(400).json({ error: 'Each device needs a name and numeric entity ID.' });
  }
  const savedDevices = devices.map((device, index) => {
    const existing = (profile.devices || []).find((item) => item.entityId === String(device.entityId));
    return { name: String(device.name), entityId: String(device.entityId), type: device.type === 'alarm' ? 'alarm' : 'switch', sortOrder: sortOrder(existing || {}, index) };
  });
  setActiveProfile({ ...profile, server: { host: String(server.host), port: String(server.port), playerId: String(server.playerId), playerToken, useProxy: Boolean(server.useProxy) }, devices: savedDevices, groups: reconcileGroups(profile.groups, savedDevices) });
  deviceStates = {};
  connect();
  response.json({ ok: true });
});

app.post('/api/devices/:entityId', (request, response) => {
  const entityId = String(request.params.entityId);
  const enabled = request.body && request.body.enabled;
  if (typeof enabled !== 'boolean') return response.status(400).json({ error: 'enabled must be boolean.' });
  if (!client || !status.connected) return response.status(409).json({ error: 'Rust+ is not connected.' });
  if (!(activeProfile()?.devices || []).some((device) => device.entityId === entityId && device.type !== 'alarm')) return response.status(404).json({ error: 'Unknown switch.' });
  client.setEntityValue(entityId, enabled, (message) => {
    if (message.response && message.response.error) return;
    publishEntityState(entityId, enabled);
  });
  response.status(202).json({ ok: true });
});

app.patch('/api/devices/:entityId', (request, response) => {
  const entityId = String(request.params.entityId);
  const name = String(request.body?.name || '').trim();
  if (!name || name.length > 80) return response.status(400).json({ error: 'Device name must be between 1 and 80 characters.' });
  const profile = activeProfile();
  if (!profile) return response.status(404).json({ error: 'No active server.' });
  const device = (profile.devices || []).find((item) => item.entityId === entityId);
  if (!device) return response.status(404).json({ error: 'Unknown device.' });
  setActiveProfile({ ...profile, devices: profile.devices.map((item) => item.entityId === entityId ? { ...item, name } : item) });
  response.json({ ok: true });
});

app.post('/api/groups', (request, response) => {
  const profile = activeProfile();
  if (!profile) return response.status(404).json({ error: 'No active server.' });
  const input = groupInput(request.body, profile);
  if (input.error) return response.status(400).json({ error: input.error });
  const group = { id: crypto.randomUUID(), sortOrder: nextSortOrder(profile), ...input };
  setActiveProfile({ ...profile, groups: [...(profile.groups || []), group] });
  response.status(201).json({ group });
});

app.patch('/api/groups/:id', (request, response) => {
  const profile = activeProfile();
  if (!profile) return response.status(404).json({ error: 'No active server.' });
  const groups = profile.groups || [];
  if (!groups.some((group) => group.id === request.params.id)) return response.status(404).json({ error: 'Unknown group.' });
  const input = groupInput(request.body, profile, request.params.id);
  if (input.error) return response.status(400).json({ error: input.error });
  setActiveProfile({ ...profile, groups: groups.map((group) => group.id === request.params.id ? { ...group, ...input } : group) });
  response.json({ ok: true });
});

app.delete('/api/groups/:id', (request, response) => {
  const profile = activeProfile();
  if (!profile) return response.status(404).json({ error: 'No active server.' });
  const groups = profile.groups || [];
  if (!groups.some((group) => group.id === request.params.id)) return response.status(404).json({ error: 'Unknown group.' });
  setActiveProfile({ ...profile, groups: groups.filter((group) => group.id !== request.params.id) });
  response.status(204).end();
});

app.post('/api/groups/:id/switch', (request, response) => {
  const enabled = request.body?.enabled;
  if (typeof enabled !== 'boolean') return response.status(400).json({ error: 'enabled must be boolean.' });
  if (!client || !status.connected) return response.status(409).json({ error: 'Rust+ is not connected.' });
  const group = (activeProfile()?.groups || []).find((item) => item.id === request.params.id);
  if (!group) return response.status(404).json({ error: 'Unknown group.' });
  for (const entityId of group.deviceIds) {
    client.setEntityValue(entityId, enabled, (message) => {
      if (!message.response?.error) publishEntityState(entityId, enabled);
    });
  }
  response.status(202).json({ ok: true });
});

app.post('/api/items/:type/:id/move', (request, response) => {
  const type = request.params.type;
  const direction = request.body?.direction;
  if (!['group', 'device'].includes(type) || ![-1, 1].includes(direction)) return response.status(400).json({ error: 'type and direction are invalid.' });
  const profile = activeProfile();
  if (!profile) return response.status(404).json({ error: 'No active server.' });
  const nextProfile = moveProfileItem(profile, type, request.params.id, direction);
  if (!nextProfile) return response.status(409).json({ error: 'Item cannot be moved further.' });
  setActiveProfile(nextProfile);
  response.json({ ok: true });
});

app.listen(PORT, HOST, () => {
  console.log(`Rust+ Control is running at http://${HOST}:${PORT}`);
  if (fcmStatus.registered) {
    startFcmListener();
    connect();
  } else {
    status = { connected: false, message: 'Log in to connect Rust+' };
  }
});
