const connection = document.querySelector('#connection');
const controlList = document.querySelector('#control-list');
const feedback = document.querySelector('#feedback');
const eventList = document.querySelector('#event-list');
const notificationButton = document.querySelector('#enable-notifications');
const notificationState = document.querySelector('#notification-state');
const configureDiscordButton = document.querySelector('#configure-discord');
const discordState = document.querySelector('#discord-state');
const discordDialog = document.querySelector('#discord-dialog');
const discordForm = document.querySelector('#discord-form');
const discordWebhookUrl = document.querySelector('#discord-webhook-url');
const saveDiscord = document.querySelector('#save-discord');
const editSettingsButton = document.querySelector('#edit-settings');
const settingsDialog = document.querySelector('#settings-dialog');
const settingsForm = document.querySelector('#settings-form');
const saveSettings = document.querySelector('#save-settings');
const settingsServerName = document.querySelector('#settings-server-name');
const settingsServerHost = document.querySelector('#settings-server-host');
const settingsServerPort = document.querySelector('#settings-server-port');
const settingsPlayerId = document.querySelector('#settings-player-id');
const settingsPlayerToken = document.querySelector('#settings-player-token');
const settingsUseProxy = document.querySelector('#settings-use-proxy');
const settingsAndroidId = document.querySelector('#settings-android-id');
const settingsSecurityToken = document.querySelector('#settings-security-token');
const settingsFcmToken = document.querySelector('#settings-fcm-token');
const settingsExpoPushToken = document.querySelector('#settings-expo-push-token');
const settingsRustplusAuthToken = document.querySelector('#settings-rustplus-auth-token');
const showSettingsSecrets = document.querySelector('#show-settings-secrets');
const createGroupButton = document.querySelector('#create-group');
const importDevicesButton = document.querySelector('#import-devices');
const exportDevicesButton = document.querySelector('#export-devices');
const importDevicesFile = document.querySelector('#import-devices-file');
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
const COLLAPSED_GROUPS_STORAGE_KEY = 'rustplus-control.collapsed-groups';
const EVENTS_STORAGE_KEY = 'rustplus-control.events';
const MAX_STORED_EVENTS = 150;
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
  configureDiscordButton.disabled = !state.config.activeServerId;
  editSettingsButton.disabled = !state.config.activeServerId;
  importDevicesButton.disabled = !state.config.activeServerId;
  exportDevicesButton.disabled = !state.config.activeServerId;
  discordState.textContent = state.config.discordConfigured ? 'Discord alarm notifications are enabled.' : 'Discord alarm notifications are not configured.';
  renderControls(state);
}

function sortItems(items) {
  return [...items].sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0));
}

function collapsedGroups() {
  try {
    const stored = JSON.parse(localStorage.getItem(COLLAPSED_GROUPS_STORAGE_KEY) || '{}');
    return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
  } catch {
    return {};
  }
}

function isGroupCollapsed(serverId, groupId) {
  return collapsedGroups()[serverId]?.includes(groupId) || false;
}

function toggleGroupCollapsed(serverId, groupId) {
  const groups = collapsedGroups();
  const collapsed = new Set(groups[serverId] || []);
  if (collapsed.has(groupId)) collapsed.delete(groupId);
  else collapsed.add(groupId);
  groups[serverId] = [...collapsed];
  localStorage.setItem(COLLAPSED_GROUPS_STORAGE_KEY, JSON.stringify(groups));
}

function toggleMarkup(name, enabled, className) {
  return `<button type="button" class="toggle-switch ${className} ${enabled ? 'is-on' : ''}" role="switch" aria-checked="${enabled}" aria-label="Toggle ${escapeHtml(name)}"><span></span></button>`;
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
  const storage = state.storageStates?.[device.entityId];
  const isAlarm = device.type === 'alarm';
  const isStorage = device.type === 'storage';
  const isSwitch = device.type === 'switch';
  const stateLabel = isStorage ? storage ? `${storage.items.length} / ${storage.capacity || '?'} slots used` : 'Storage state unknown' : enabled === undefined ? 'State unknown' : enabled ? isAlarm ? 'Alarm active' : 'Powered on' : isAlarm ? 'Monitoring' : 'Powered off';
  const deviceIcon = device.iconUrl
    ? `<img class="device-icon" src="${escapeHtml(device.iconUrl)}" alt="">`
    : '';
  const storageItems = isStorage && storage ? `<ul class="storage-items">${storage.items.map((item) => { const itemName = `${item.item?.displayName || `Item ${item.itemId}`}${item.itemIsBlueprint ? ' blueprint' : ''}`; return `<li title="${escapeHtml(itemName)}">${item.item?.iconUrl ? `<img src="${escapeHtml(item.item.iconUrl)}" alt="${escapeHtml(itemName)}">` : ''}<strong>${item.quantity}</strong></li>`; }).join('')}</ul>` : '';
  const actions = `<div class="control-actions"><button type="button" class="sort-button move-up" title="Move up" aria-label="Move ${escapeHtml(device.name)} up">&uarr;</button><button type="button" class="sort-button move-down" title="Move down" aria-label="Move ${escapeHtml(device.name)} down">&darr;</button><button type="button" class="secondary rename-device" aria-label="Rename ${escapeHtml(device.name)}">Rename</button>${isSwitch ? toggleMarkup(device.name, enabled === true, 'device-switch') : ''}</div>`;
  const row = document.createElement('article');
  row.className = `control-row ${isStorage ? 'storage-row' : ''} ${child ? 'group-child' : ''}`;
  row.innerHTML = isStorage
    ? `<div class="storage-header"><div class="control-info"><h3>${deviceIcon}${escapeHtml(device.name)}</h3><p>${stateLabel}</p></div>${actions}</div>${storageItems}`
    : `<div class="control-info"><h3>${deviceIcon}${escapeHtml(device.name)}</h3><p>${stateLabel}</p></div>${actions}`;
  addOrderControls(row, 'device', device.entityId, position, count);
  row.querySelector('.rename-device').addEventListener('click', () => openDeviceEditor(device));
  if (isSwitch) row.querySelector('.device-switch').addEventListener('click', (event) => toggle(device.entityId, enabled !== true, event.currentTarget));
  return row;
}

function renderControls(state) {
  createGroupButton.disabled = !state.config.devices.length;
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
    const groupDevices = group.deviceIds.map((entityId) => state.config.devices.find((device) => device.entityId === entityId)).filter(Boolean);
    const groupSwitches = groupDevices.filter((device) => device.type === 'switch');
    const allEnabled = groupSwitches.every((device) => state.deviceStates[device.entityId] === true);
    const collapsed = isGroupCollapsed(state.config.activeServerId || '', group.id);
    const groupRow = document.createElement('article');
    groupRow.className = 'control-row group-row';
    groupRow.innerHTML = `<div class="control-info"><h3>${escapeHtml(group.name)}</h3><p>${groupDevices.length} device${groupDevices.length === 1 ? '' : 's'}</p></div><div class="control-actions group-actions"><div class="group-action-row"><button type="button" class="secondary edit-group" aria-label="Edit ${escapeHtml(group.name)}">Edit</button><button type="button" class="collapse-group ${collapsed ? 'is-collapsed' : ''}" title="${collapsed ? 'Expand' : 'Collapse'} ${escapeHtml(group.name)}" aria-label="${collapsed ? 'Expand' : 'Collapse'} ${escapeHtml(group.name)}" aria-expanded="${!collapsed}"><span class="collapse-icon" aria-hidden="true"></span></button></div><div class="group-action-row"><button type="button" class="sort-button move-up" title="Move up" aria-label="Move ${escapeHtml(group.name)} up">&uarr;</button><button type="button" class="sort-button move-down" title="Move down" aria-label="Move ${escapeHtml(group.name)} down">&darr;</button>${groupSwitches.length ? toggleMarkup(group.name, allEnabled, 'group-switch') : ''}</div></div>`;
    addOrderControls(groupRow, 'group', group.id, index, rootItems.length);
    groupRow.querySelector('.collapse-group').addEventListener('click', () => {
      toggleGroupCollapsed(state.config.activeServerId || '', group.id);
      renderControls(state);
    });
    groupRow.querySelector('.edit-group').addEventListener('click', () => openGroupEditor(group));
    if (groupSwitches.length) groupRow.querySelector('.group-switch').addEventListener('click', (event) => toggleGroup(group.id, !allEnabled, event.currentTarget));
    controlList.append(groupRow);
    const children = sortItems(group.deviceIds.map((entityId) => state.config.devices.find((device) => device.entityId === entityId)).filter(Boolean));
    if (!collapsed) children.forEach((device, childIndex) => controlList.append(renderDeviceRow(device, state, childIndex, children.length, true)));
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
  groupDialogTitle.textContent = group ? 'Edit device group' : 'New device group';
  groupName.value = group?.name || '';
  deleteGroupButton.hidden = !group;
  groupMembers.innerHTML = '<legend>Devices</legend>';
  for (const device of currentState.config.devices.filter((item) => !groupedIds.has(item.entityId))) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = device.entityId;
    input.checked = selectedIds.has(device.entityId);
    label.append(input, document.createTextNode(device.name));
    groupMembers.append(label);
  }
  groupDialog.showModal();
  groupName.focus();
}

function openDiscordSettings() {
  if (!currentState?.config.activeServerId) return;
  discordWebhookUrl.value = '';
  discordDialog.showModal();
  discordWebhookUrl.focus();
}

async function openSettings() {
  const result = await apiFetch('/api/settings');
  if (!result.ok) { feedback.textContent = (await result.json()).error || 'Unable to load settings.'; return; }
  const settings = await result.json();
  settingsServerName.value = settings.server.name;
  settingsServerHost.value = settings.server.host;
  settingsServerPort.value = settings.server.port;
  settingsPlayerId.value = settings.server.playerId;
  settingsPlayerToken.value = settings.server.playerToken;
  settingsUseProxy.checked = settings.server.useProxy;
  settingsAndroidId.value = settings.fcm.androidId;
  settingsSecurityToken.value = settings.fcm.securityToken;
  settingsFcmToken.value = settings.fcm.token;
  settingsExpoPushToken.value = settings.fcm.expoPushToken;
  settingsRustplusAuthToken.value = settings.fcm.rustplusAuthToken;
  showSettingsSecrets.checked = false;
  setSettingsSecretVisibility();
  settingsDialog.showModal();
  settingsServerName.focus();
}

function setSettingsSecretVisibility() {
  const type = showSettingsSecrets.checked ? 'text' : 'password';
  for (const input of [settingsPlayerToken, settingsAndroidId, settingsSecurityToken, settingsFcmToken, settingsExpoPushToken, settingsRustplusAuthToken]) input.type = type;
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

async function exportDevices() {
  exportDevicesButton.disabled = true;
  try {
    const result = await apiFetch('/api/device-backup');
    if (!result.ok) { feedback.textContent = (await result.json()).error || 'Unable to export devices.'; return; }
    const backup = await result.json();
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const download = document.createElement('a');
    download.href = URL.createObjectURL(blob);
    download.download = `rustplus-devices-${new Date().toISOString().slice(0, 10)}.json`;
    download.click();
    URL.revokeObjectURL(download.href);
  } finally {
    exportDevicesButton.disabled = false;
  }
}

async function importDevices(file) {
  try {
    const backup = JSON.parse(await file.text());
    if (!confirm('Replace the current devices and groups with this backup?')) return;
    importDevicesButton.disabled = true;
    const result = await apiFetch('/api/device-backup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(backup) });
    if (!result.ok) { feedback.textContent = (await result.json()).error || 'Unable to import devices.'; return; }
    feedback.textContent = 'Devices imported.';
    await refresh();
  } catch {
    feedback.textContent = 'Choose a valid device backup file.';
  } finally {
    importDevicesButton.disabled = false;
    importDevicesFile.value = '';
  }
}

function escapeHtml(value) { const div = document.createElement('div'); div.textContent = value; return div.innerHTML; }
function normalizeEvent(event) {
  const createdAt = new Date(event?.createdAt);
  return {
    id: String(event?.id || `${Date.now()}:${Math.random()}`),
    title: String(event?.title || 'Map event').slice(0, 160),
    body: String(event?.body || '').slice(0, 600),
    createdAt: Number.isNaN(createdAt.getTime()) ? new Date().toISOString() : createdAt.toISOString(),
  };
}
function storedEvents() {
  try {
    const events = JSON.parse(localStorage.getItem(EVENTS_STORAGE_KEY) || '[]');
    return Array.isArray(events) ? events.filter((event) => event && typeof event === 'object').map(normalizeEvent).slice(0, MAX_STORED_EVENTS) : [];
  } catch {
    return [];
  }
}
function saveEvent(event) {
  try {
    const events = [event, ...storedEvents().filter((stored) => stored.id !== event.id)].slice(0, MAX_STORED_EVENTS);
    localStorage.setItem(EVENTS_STORAGE_KEY, JSON.stringify(events));
  } catch {
    // Storage can be unavailable or full; the current-page event list still works.
  }
}
function renderEvent(event, prepend = true) {
  const item = document.createElement('p');
  const date = new Date(event.createdAt);
  const time = date.toLocaleString(undefined, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  item.innerHTML = `<span><strong>${escapeHtml(event.title)}</strong> ${escapeHtml(event.body)}</span><time datetime="${date.toISOString()}">${escapeHtml(time)}</time>`;
  if (prepend) eventList.prepend(item);
  else eventList.append(item);
  while (eventList.children.length > MAX_STORED_EVENTS) eventList.lastElementChild.remove();
}
function updateNotificationState() {
  if (!('Notification' in window)) { notificationState.textContent = 'Browser notifications are not supported.'; notificationButton.disabled = true; return; }
  notificationState.textContent = Notification.permission === 'granted' ? 'Browser notifications are enabled.' : 'Allow notifications to receive map events.';
}
function showEvent(event) {
  const normalized = normalizeEvent(event);
  saveEvent(normalized);
  renderEvent(normalized);
  if ('Notification' in window && Notification.permission === 'granted') new Notification(normalized.title, { body: normalized.body });
}
document.querySelector('#register-rustplus').addEventListener('click', async () => { await apiFetch('/api/fcm/register', { method: 'POST' }); refreshPairingStatus(); });
document.querySelector('#logout-rustplus').addEventListener('click', async () => { await apiFetch('/api/fcm/logout', { method: 'POST' }); pairingDialog.close(); activePairing = null; await refreshPairingStatus(); await refresh(); });
exportDevicesButton.addEventListener('click', exportDevices);
importDevicesButton.addEventListener('click', () => importDevicesFile.click());
importDevicesFile.addEventListener('change', () => { if (importDevicesFile.files?.[0]) importDevices(importDevicesFile.files[0]); });
signOutButton.addEventListener('click', signOut);
serverSelect.addEventListener('change', async () => {
  if (!serverSelect.value) return;
  const result = await apiFetch(`/api/servers/${encodeURIComponent(serverSelect.value)}/activate`, { method: 'POST' });
  if (!result.ok) feedback.textContent = (await result.json()).error || 'Unable to switch server.';
  await refresh();
});
notificationButton.addEventListener('click', async () => { if ('Notification' in window) await Notification.requestPermission(); updateNotificationState(); });
configureDiscordButton.addEventListener('click', openDiscordSettings);
document.querySelector('#cancel-discord').addEventListener('click', () => discordDialog.close());
editSettingsButton.addEventListener('click', openSettings);
document.querySelector('#cancel-settings').addEventListener('click', () => settingsDialog.close());
showSettingsSecrets.addEventListener('change', setSettingsSecretVisibility);
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
discordForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  saveDiscord.disabled = true;
  const result = await apiFetch('/api/discord-webhook', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: discordWebhookUrl.value.trim() }) });
  saveDiscord.disabled = false;
  if (!result.ok) { feedback.textContent = (await result.json()).error || 'Unable to save Discord webhook.'; return; }
  discordDialog.close();
  await refresh();
});
settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  saveSettings.disabled = true;
  const result = await apiFetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      server: { name: settingsServerName.value.trim(), host: settingsServerHost.value.trim(), port: settingsServerPort.value.trim(), playerId: settingsPlayerId.value.trim(), playerToken: settingsPlayerToken.value.trim(), useProxy: settingsUseProxy.checked },
      fcm: { androidId: settingsAndroidId.value.trim(), securityToken: settingsSecurityToken.value.trim(), token: settingsFcmToken.value.trim(), expoPushToken: settingsExpoPushToken.value.trim(), rustplusAuthToken: settingsRustplusAuthToken.value.trim() },
    }),
  });
  saveSettings.disabled = false;
  if (!result.ok) { feedback.textContent = (await result.json()).error || 'Unable to save settings.'; return; }
  settingsDialog.close();
  await refresh();
  await refreshPairingStatus();
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
storedEvents().forEach((event) => renderEvent(event, false));
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
