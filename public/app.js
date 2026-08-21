const connection = document.querySelector('#connection');
const controlList = document.querySelector('#control-list');
const feedback = document.querySelector('#feedback');
const eventList = document.querySelector('#event-list');
const notificationButton = document.querySelector('#enable-notifications');
const notificationState = document.querySelector('#notification-state');
const createGroupButton = document.querySelector('#create-group');
const pairingSection = document.querySelector('#pairing');
const pairingStatus = document.querySelector('#pairing-status');
const registerButton = document.querySelector('#register-rustplus');
const pairingDialog = document.querySelector('#pairing-dialog');
const pairingForm = document.querySelector('#pairing-form');
const pairingDeviceId = document.querySelector('#pairing-device-id');
const pairingDeviceName = document.querySelector('#pairing-device-name');
const pairingDeviceType = document.querySelector('#pairing-device-type');
const deviceDialog = document.querySelector('#device-dialog');
const deviceForm = document.querySelector('#device-form');
const deviceName = document.querySelector('#device-name');
const saveDeviceName = document.querySelector('#save-device-name');
const groupDialog = document.querySelector('#group-dialog');
const groupForm = document.querySelector('#group-form');
const groupDialogTitle = document.querySelector('#group-dialog-title');
const groupName = document.querySelector('#group-name');
const groupMembers = document.querySelector('#group-members');
const saveGroup = document.querySelector('#save-group');
const deleteGroupButton = document.querySelector('#delete-group');
const serverSelect = document.querySelector('#server-select');
const signOutButton = document.querySelector('#sign-out');
let activePairing = null;
let activeDevice = null;
let activeGroup = null;
let currentState = null;

function render(state) {
  currentState = state;
  connection.textContent = state.message;
  connection.className = `status ${state.connected ? 'online' : ''}`;
  serverSelect.innerHTML = '';
  if (!state.config.servers.length) serverSelect.add(new Option('No paired servers', ''));
  for (const server of state.config.servers) serverSelect.add(new Option(server.name, server.id));
  serverSelect.value = state.config.activeServerId || '';
  serverSelect.disabled = !state.config.servers.length;
  renderControls(state);
}

function sortItems(items) {
  return [...items].sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0));
}

function toggleMarkup(name, enabled, connected, className) {
  return `<button type="button" class="toggle-switch ${className} ${enabled ? 'is-on' : ''}" role="switch" aria-checked="${enabled}" aria-label="Toggle ${escapeHtml(name)}" ${connected ? '' : 'disabled'}><span></span></button>`;
}

function addOrderControls(row, type, id, position, count) {
  const up = row.querySelector('.move-up');
  const down = row.querySelector('.move-down');
  up.disabled = position === 0;
  down.disabled = position === count - 1;
  up.addEventListener('click', () => moveItem(type, id, -1));
  down.addEventListener('click', () => moveItem(type, id, 1));
}

function renderDeviceRow(device, state, position, count, child = false) {
  const enabled = state.deviceStates[device.entityId];
  const isAlarm = device.type === 'alarm';
  const stateLabel = enabled === undefined ? 'State unknown' : enabled ? isAlarm ? 'Alarm active' : 'Powered on' : isAlarm ? 'Monitoring' : 'Powered off';
  const row = document.createElement('article');
  row.className = `control-row ${child ? 'group-child' : ''}`;
  row.innerHTML = `<div class="control-info"><h3>${escapeHtml(device.name)}</h3><p>${stateLabel}</p></div><div class="control-actions"><button type="button" class="sort-button move-up" title="Move up" aria-label="Move ${escapeHtml(device.name)} up">&uarr;</button><button type="button" class="sort-button move-down" title="Move down" aria-label="Move ${escapeHtml(device.name)} down">&darr;</button><button type="button" class="secondary rename-device" aria-label="Rename ${escapeHtml(device.name)}">Rename</button>${isAlarm ? '<span class="alarm-status">ALARM</span>' : toggleMarkup(device.name, enabled === true, state.connected, 'device-switch')}</div>`;
  addOrderControls(row, 'device', device.entityId, position, count);
  row.querySelector('.rename-device').addEventListener('click', () => openDeviceEditor(device));
  if (!isAlarm) row.querySelector('.device-switch').addEventListener('click', (event) => toggle(device.entityId, enabled !== true, event.currentTarget));
  return row;
}

function renderControls(state) {
  const switches = state.config.devices.filter((device) => device.type !== 'alarm');
  createGroupButton.disabled = !switches.length;
  controlList.innerHTML = '';
  const groups = state.config.groups || [];
  const groupedIds = new Set(groups.flatMap((group) => group.deviceIds));
  const rootItems = sortItems([...groups.map((group) => ({ ...group, itemType: 'group' })), ...state.config.devices.filter((device) => !groupedIds.has(device.entityId)).map((device) => ({ ...device, itemType: 'device' }))]);
  for (let index = 0; index < rootItems.length; index += 1) {
    const item = rootItems[index];
    if (item.itemType === 'device') {
      controlList.append(renderDeviceRow(item, state, index, rootItems.length));
      continue;
    }
    const group = item;
    const allEnabled = group.deviceIds.every((entityId) => state.deviceStates[entityId] === true);
    const groupRow = document.createElement('article');
    groupRow.className = 'control-row group-row';
    groupRow.innerHTML = `<div class="control-info"><h3>${escapeHtml(group.name)}</h3><p>${group.deviceIds.length} switch${group.deviceIds.length === 1 ? '' : 'es'}</p></div><div class="control-actions"><button type="button" class="sort-button move-up" title="Move up" aria-label="Move ${escapeHtml(group.name)} up">&uarr;</button><button type="button" class="sort-button move-down" title="Move down" aria-label="Move ${escapeHtml(group.name)} down">&darr;</button><button type="button" class="secondary edit-group" aria-label="Edit ${escapeHtml(group.name)}">Edit</button>${toggleMarkup(group.name, allEnabled, state.connected, 'group-switch')}</div>`;
    addOrderControls(groupRow, 'group', group.id, index, rootItems.length);
    groupRow.querySelector('.edit-group').addEventListener('click', () => openGroupEditor(group));
    groupRow.querySelector('.group-switch').addEventListener('click', (event) => toggleGroup(group.id, !allEnabled, event.currentTarget));
    controlList.append(groupRow);
    const children = sortItems(group.deviceIds.map((entityId) => state.config.devices.find((device) => device.entityId === entityId)).filter(Boolean));
    children.forEach((device, childIndex) => controlList.append(renderDeviceRow(device, state, childIndex, children.length, true)));
  }
  if (!rootItems.length) controlList.innerHTML = '<p class="empty">Pair a Smart Switch or Smart Alarm in Rust to add it here.</p>';
}

async function toggle(entityId, enabled, control) {
  control.disabled = true;
  const result = await apiFetch(`/api/devices/${encodeURIComponent(entityId)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) });
  if (!result.ok) feedback.textContent = (await result.json()).error || 'Command failed.';
  await refresh();
}

async function refresh() {
  const response = await apiFetch('/api/state');
  if (!response.ok) return;
  const state = await response.json();
  render(state);
}

async function refreshPairingStatus() {
  const response = await apiFetch('/api/fcm/status');
  if (!response.ok) return;
  const status = await response.json();
  pairingSection.hidden = !status.registrationAvailable;
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

function openDeviceEditor(device) {
  activeDevice = device;
  deviceName.value = device.name;
  deviceDialog.showModal();
  deviceName.focus();
}

function openGroupEditor(group = null) {
  if (!currentState) return;
  activeGroup = group;
  const selectedIds = new Set(group?.deviceIds || []);
  const groupedIds = new Set((currentState.config.groups || []).filter((item) => item.id !== group?.id).flatMap((item) => item.deviceIds));
  groupDialogTitle.textContent = group ? 'Edit switch group' : 'New switch group';
  groupName.value = group?.name || '';
  deleteGroupButton.hidden = !group;
  groupMembers.innerHTML = '<legend>Switches</legend>';
  for (const device of currentState.config.devices.filter((item) => item.type !== 'alarm')) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = device.entityId;
    input.checked = selectedIds.has(device.entityId);
    input.disabled = groupedIds.has(device.entityId);
    label.append(input, document.createTextNode(device.name));
    groupMembers.append(label);
  }
  groupDialog.showModal();
  groupName.focus();
}

async function toggleGroup(groupId, enabled, control) {
  control.disabled = true;
  const result = await apiFetch(`/api/groups/${encodeURIComponent(groupId)}/switch`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) });
  if (!result.ok) feedback.textContent = (await result.json()).error || 'Unable to switch group.';
  await refresh();
}

async function moveItem(type, id, direction) {
  const result = await apiFetch(`/api/items/${encodeURIComponent(type)}/${encodeURIComponent(id)}/move`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ direction }) });
  if (!result.ok) feedback.textContent = (await result.json()).error || 'Unable to move item.';
  await refresh();
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
document.querySelector('#cancel-device-edit').addEventListener('click', () => { deviceDialog.close(); activeDevice = null; });
createGroupButton.addEventListener('click', () => openGroupEditor());
document.querySelector('#cancel-group-edit').addEventListener('click', () => { groupDialog.close(); activeGroup = null; });
pairingForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!activePairing) return;
  const result = await apiFetch(`/api/pairings/${encodeURIComponent(activePairing.id)}/accept`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: pairingDeviceName.value.trim(), type: pairingDeviceType.value }) });
  if (!result.ok) { feedback.textContent = (await result.json()).error || 'Unable to add device.'; return; }
  pairingDialog.close(); activePairing = null; await refresh(); refreshPendingPairings();
});
deviceForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!activeDevice) return;
  saveDeviceName.disabled = true;
  const result = await apiFetch(`/api/devices/${encodeURIComponent(activeDevice.entityId)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: deviceName.value.trim() }) });
  saveDeviceName.disabled = false;
  if (!result.ok) { feedback.textContent = (await result.json()).error || 'Unable to rename device.'; return; }
  deviceDialog.close();
  activeDevice = null;
  await refresh();
});
groupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const deviceIds = [...groupMembers.querySelectorAll('input:checked')].map((input) => input.value);
  const url = activeGroup ? `/api/groups/${encodeURIComponent(activeGroup.id)}` : '/api/groups';
  saveGroup.disabled = true;
  const result = await apiFetch(url, { method: activeGroup ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: groupName.value.trim(), deviceIds }) });
  saveGroup.disabled = false;
  if (!result.ok) { feedback.textContent = (await result.json()).error || 'Unable to save group.'; return; }
  groupDialog.close();
  activeGroup = null;
  await refresh();
});
deleteGroupButton.addEventListener('click', async () => {
  if (!activeGroup) return;
  deleteGroupButton.disabled = true;
  const result = await apiFetch(`/api/groups/${encodeURIComponent(activeGroup.id)}`, { method: 'DELETE' });
  deleteGroupButton.disabled = false;
  if (!result.ok) { feedback.textContent = (await result.json()).error || 'Unable to delete group.'; return; }
  groupDialog.close();
  activeGroup = null;
  await refresh();
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
