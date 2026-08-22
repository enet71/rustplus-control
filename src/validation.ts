import type {
  Device,
  DeviceBackup,
  DeviceGroup,
  FcmConfig,
  ServerProfile,
  SettingsInput,
} from './types';

type Result<T> = T | { error: string };

export function isValidationError<T>(value: Result<T>): value is { error: string } {
  return typeof value === 'object' && value !== null && 'error' in value;
}

function requiredString(value: unknown, name: string, maximum = 4096): Result<string> {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > maximum)
    return { error: `${name} is required and must be at most ${maximum} characters.` };
  return normalized;
}

export function settingsInput(body: unknown): Result<SettingsInput> {
  const value = (body || {}) as { server?: Record<string, unknown>; fcm?: Record<string, unknown> };
  const server = value.server || {};
  const fcm = value.fcm || {};
  const [
    name,
    host,
    port,
    playerId,
    playerToken,
    androidId,
    securityToken,
    fcmToken,
    expoPushToken,
    rustplusAuthToken,
  ] = [
    requiredString(server.name, 'Server name', 80),
    requiredString(server.host, 'Host', 255),
    requiredString(server.port, 'Port', 5),
    requiredString(server.playerId, 'Steam64 ID', 32),
    requiredString(server.playerToken, 'Player token'),
    requiredString(fcm.androidId, 'FCM Android ID'),
    requiredString(fcm.securityToken, 'FCM security token'),
    requiredString(fcm.token, 'FCM token', 8192),
    requiredString(fcm.expoPushToken, 'Expo push token'),
    requiredString(fcm.rustplusAuthToken, 'Rust+ auth token'),
  ];
  const values = [
    name,
    host,
    port,
    playerId,
    playerToken,
    androidId,
    securityToken,
    fcmToken,
    expoPushToken,
    rustplusAuthToken,
  ];
  const invalid = values.find(isValidationError);
  if (invalid) return invalid;
  const [
    validName,
    validHost,
    validPort,
    validPlayerId,
    validPlayerToken,
    validAndroidId,
    validSecurityToken,
    validFcmToken,
    validExpoPushToken,
    validRustplusAuthToken,
  ] = values as string[];
  if (!/^\d+$/.test(validPort) || Number(validPort) < 1 || Number(validPort) > 65535)
    return { error: 'Port must be between 1 and 65535.' };
  if (!/^\d+$/.test(validPlayerId)) return { error: 'Steam64 ID must contain only digits.' };
  const fcmConfig: FcmConfig = {
    fcm_credentials: {
      gcm: { androidId: validAndroidId, securityToken: validSecurityToken },
      fcm: { token: validFcmToken },
    },
    expo_push_token: validExpoPushToken,
    rustplus_auth_token: validRustplusAuthToken,
  };
  return {
    server: {
      name: validName,
      host: validHost,
      port: validPort,
      playerId: validPlayerId,
      playerToken: validPlayerToken,
      useProxy: Boolean(server.useProxy),
    },
    fcm: fcmConfig,
  };
}

export function groupInput(
  body: unknown,
  profile: ServerProfile,
  currentGroupId: string | null = null,
): Result<{ name: string; deviceIds: string[] }> {
  const value = (body || {}) as { name?: unknown; deviceIds?: unknown };
  const name = String(value.name || '').trim();
  const deviceIds = Array.isArray(value.deviceIds)
    ? [...new Set(value.deviceIds.map((id) => String(id)))]
    : null;
  const knownDeviceIds = new Set(profile.devices.map((device) => device.entityId));
  const groupedIds = new Set(
    profile.groups
      .filter((group) => group.id !== currentGroupId)
      .flatMap((group) => group.deviceIds),
  );
  if (!name || name.length > 80)
    return { error: 'Group name must be between 1 and 80 characters.' };
  if (!deviceIds?.length || deviceIds.some((id) => !knownDeviceIds.has(id)))
    return { error: 'A group must contain one or more known devices.' };
  if (deviceIds.some((id) => groupedIds.has(id)))
    return { error: 'A device can belong to only one group.' };
  return { name, deviceIds };
}

export function deviceBackupInput(body: unknown): Result<DeviceBackup> {
  const value = (body || {}) as { version?: unknown; devices?: unknown; groups?: unknown };
  if (value.version !== 1 || !Array.isArray(value.devices) || !Array.isArray(value.groups))
    return { error: 'Invalid device backup file.' };

  const devices: Device[] = [];
  const deviceIds = new Set<string>();
  for (let index = 0; index < value.devices.length; index += 1) {
    const item = value.devices[index] as Partial<Device> | null;
    const name = String(item?.name || '').trim();
    const entityId = String(item?.entityId || '');
    if (!name || name.length > 80 || !/^-?\d+$/.test(entityId))
      return { error: 'Each backup device needs a name and numeric entity ID.' };
    if (item?.type !== 'switch' && item?.type !== 'alarm')
      return { error: 'Each backup device needs a valid type.' };
    if (deviceIds.has(entityId)) return { error: 'Backup device IDs must be unique.' };
    const sortOrder = Number(item?.sortOrder);
    devices.push({
      name,
      entityId,
      type: item.type,
      sortOrder: Number.isFinite(sortOrder) ? sortOrder : index,
    });
    deviceIds.add(entityId);
  }

  const groups: DeviceGroup[] = [];
  const groupIds = new Set<string>();
  const groupedDeviceIds = new Set<string>();
  for (let index = 0; index < value.groups.length; index += 1) {
    const item = value.groups[index] as Partial<DeviceGroup> | null;
    const id = String(item?.id || '').trim();
    const name = String(item?.name || '').trim();
    const members = Array.isArray(item?.deviceIds)
      ? [...new Set(item.deviceIds.map((deviceId) => String(deviceId)))]
      : [];
    if (!id || id.length > 160 || !name || name.length > 80 || !members.length)
      return { error: 'Each backup group needs an ID, name and at least one device.' };
    if (groupIds.has(id)) return { error: 'Backup group IDs must be unique.' };
    if (members.some((deviceId) => !deviceIds.has(deviceId)))
      return { error: 'Backup groups can contain only exported devices.' };
    if (members.some((deviceId) => groupedDeviceIds.has(deviceId)))
      return { error: 'A backup device can belong to only one group.' };
    const sortOrder = Number(item?.sortOrder);
    groups.push({
      id,
      name,
      deviceIds: members,
      sortOrder: Number.isFinite(sortOrder) ? sortOrder : index,
    });
    groupIds.add(id);
    members.forEach((deviceId) => groupedDeviceIds.add(deviceId));
  }

  return { version: 1, devices, groups };
}

export function discordWebhookUrl(value: unknown): Result<{ url: string }> {
  const url = String(value || '').trim();
  if (!url) return { url: '' };
  try {
    const parsed = new URL(url);
    const validHost = [
      'discord.com',
      'discordapp.com',
      'ptb.discord.com',
      'canary.discord.com',
    ].includes(parsed.hostname);
    if (
      parsed.protocol !== 'https:' ||
      !validHost ||
      !/^\/api\/webhooks\/[^/]+\/[^/]+/.test(parsed.pathname)
    )
      throw new Error('invalid');
    return { url: parsed.toString() };
  } catch {
    return { error: 'Enter a valid Discord webhook URL.' };
  }
}

export function validationError<T>(result: Result<T>): string | null {
  return isValidationError(result) ? result.error : null;
}
