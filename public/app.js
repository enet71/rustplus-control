const connection = document.querySelector('#connection');
const devices = document.querySelector('#devices');
const form = document.querySelector('#config-form');
const feedback = document.querySelector('#feedback');
const eventList = document.querySelector('#event-list');
const notificationButton = document.querySelector('#enable-notifications');
const notificationState = document.querySelector('#notification-state');
const pairingStatus = document.querySelector('#pairing-status');
const registerButton = document.querySelector('#register-rustplus');
const pairingDialog = document.querySelector('#pairing-dialog');
const pairingForm = document.querySelector('#pairing-form');
const pairingDeviceId = document.querySelector('#pairing-device-id');
const pairingDeviceName = document.querySelector('#pairing-device-name');
const pairingDeviceType = document.querySelector('#pairing-device-type');
const serverSelect = document.querySelector('#server-select');
const signOutButton = document.querySelector('#sign-out');
let formHydrated = false;
let displayedServerId = null;
let activePairing = null;

function render(state) {
  connection.textContent = state.message;
  connection.className = `status ${state.connected ? 'online' : ''}`;
  serverSelect.innerHTML = '';
  if (!state.config.servers.length) serverSelect.add(new Option('No paired servers', ''));
  for (const server of state.config.servers) serverSelect.add(new Option(server.name, server.id));
  serverSelect.value = state.config.activeServerId || '';
  serverSelect.disabled = !state.config.servers.length;
  devices.innerHTML = '';
  for (const device of state.config.devices) {
    const enabled = state.deviceStates[device.entityId];
    const card = document.createElement('article');
    card.className = 'device';
    const isAlarm = device.type === 'alarm';
    const stateLabel = enabled === undefined ? 'State unknown' : enabled ? isAlarm ? 'Alarm active' : 'Powered on' : isAlarm ? 'Monitoring' : 'Powered off';
    card.innerHTML = `<div><h2>${escapeHtml(device.name)}</h2><p>${stateLabel}</p></div>${isAlarm ? '<span class="alarm-status">ALARM</span>' : `<button ${state.connected ? '' : 'disabled'} class="power ${enabled ? 'active' : ''}" aria-label="Toggle ${escapeHtml(device.name)}">${enabled ? 'ON' : 'OFF'}</button>`}`;
    if (!isAlarm) card.querySelector('button').addEventListener('click', () => toggle(device.entityId, !enabled));
    devices.append(card);
  }
  if (!state.config.devices.length) devices.innerHTML = '<p class="empty">Pair a Smart Switch or Smart Alarm in Rust to add it here.</p>';
}

async function toggle(entityId, enabled) {
  const result = await apiFetch(`/api/devices/${encodeURIComponent(entityId)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) });
  if (!result.ok) feedback.textContent = (await result.json()).error || 'Command failed.';
  await refresh();
}

async function refresh() {
  const response = await apiFetch('/api/state');
  if (!response.ok) return;
  const state = await response.json();
  render(state);
  if (!formHydrated || displayedServerId !== state.config.activeServerId) {
    const server = state.config.server;
    for (const name of ['host', 'port', 'playerId']) form.elements[name].value = server[name] || '';
    form.elements.useProxy.checked = Boolean(server.useProxy);
    if (server.hasPlayerToken) form.elements.playerToken.placeholder = 'Saved locally (enter only to replace)';
    formHydrated = true;
    displayedServerId = state.config.activeServerId;
  }
}

async function refreshPairingStatus() {
  const response = await apiFetch('/api/fcm/status');
  if (!response.ok) return;
  const status = await response.json();
  pairingStatus.textContent = status.message;
  registerButton.disabled = status.registered;
}

async function refreshPendingPairings() {
  const response = await apiFetch('/api/pairings/pending');
  if (!response.ok) return;
  const pending = await response.json();
  if (!activePairing && pending.length) openPairing(pending[0]);
}

function openPairing(pairing) {
  activePairing = pairing;
  pairingDeviceId.textContent = `Entity ID: ${pairing.entityId}`;
  pairingDeviceName.value = pairing.name;
  pairingDeviceType.value = pairing.type;
  pairingDialog.showModal();
}

function escapeHtml(value) { const div = document.createElement('div'); div.textContent = value; return div.innerHTML; }
function updateNotificationState() {
  if (!('Notification' in window)) { notificationState.textContent = 'Browser notifications are not supported.'; notificationButton.disabled = true; return; }
  notificationState.textContent = Notification.permission === 'granted' ? 'Browser notifications are enabled.' : 'Allow notifications to receive map events.';
}
function showEvent(event) {
  const item = document.createElement('p');
  item.innerHTML = `<strong>${escapeHtml(event.title)}</strong> ${escapeHtml(event.body)}`;
  eventList.prepend(item);
  while (eventList.children.length > 8) eventList.lastElementChild.remove();
  if ('Notification' in window && Notification.permission === 'granted') new Notification(event.title, { body: event.body });
}
document.querySelector('#register-rustplus').addEventListener('click', async () => { await apiFetch('/api/fcm/register', { method: 'POST' }); refreshPairingStatus(); });
document.querySelector('#logout-rustplus').addEventListener('click', async () => { await apiFetch('/api/fcm/logout', { method: 'POST' }); pairingDialog.close(); activePairing = null; await refreshPairingStatus(); await refresh(); });
signOutButton.addEventListener('click', signOut);
serverSelect.addEventListener('change', async () => {
  if (!serverSelect.value) return;
  const result = await apiFetch(`/api/servers/${encodeURIComponent(serverSelect.value)}/activate`, { method: 'POST' });
  if (!result.ok) feedback.textContent = (await result.json()).error || 'Unable to switch server.';
  await refresh();
});
notificationButton.addEventListener('click', async () => { if ('Notification' in window) await Notification.requestPermission(); updateNotificationState(); });
document.querySelector('#reject-pairing').addEventListener('click', async () => {
  if (activePairing) await apiFetch(`/api/pairings/${encodeURIComponent(activePairing.id)}`, { method: 'DELETE' });
  pairingDialog.close(); activePairing = null; refreshPendingPairings();
});
pairingForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!activePairing) return;
  const result = await apiFetch(`/api/pairings/${encodeURIComponent(activePairing.id)}/accept`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: pairingDeviceName.value.trim(), type: pairingDeviceType.value }) });
  if (!result.ok) { feedback.textContent = (await result.json()).error || 'Unable to add device.'; return; }
  pairingDialog.close(); activePairing = null; await refresh(); refreshPendingPairings();
});
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const payload = { server: Object.fromEntries(data) };
  payload.server.useProxy = form.elements.useProxy.checked;
  const result = await apiFetch('/api/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  feedback.textContent = result.ok ? 'Saved. Connecting...' : (await result.json()).error;
  if (result.ok) setTimeout(refresh, 400);
});
refresh(); setInterval(refresh, 3000);
refreshPairingStatus(); setInterval(refreshPairingStatus, 3000);
refreshPendingPairings(); setInterval(refreshPendingPairings, 5000);
updateNotificationState();
async function subscribeEvents() {
  try {
    const response = await apiFetch('/api/events', { headers: { Accept: 'text/event-stream' } });
    if (!response.ok || !response.body) throw new Error('Event stream unavailable');
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      const events = buffer.split('\n\n');
      buffer = events.pop();
      for (const eventText of events) {
        const data = eventText.split('\n').find((line) => line.startsWith('data: '));
        if (!data) continue;
        const event = JSON.parse(data.slice('data: '.length));
        showEvent(event);
        if (event.type === 'pairing-device') refreshPendingPairings();
      }
    }
  } catch {
    // The stream is retried below while the authenticated dashboard remains open.
  }
  setTimeout(subscribeEvents, 3000);
}

subscribeEvents();
