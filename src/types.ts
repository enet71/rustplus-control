export type DeviceType = 'switch' | 'alarm' | 'storage';

export interface RustServerSettings {
  host: string;
  port: string;
  playerId: string;
  playerToken: string;
  useProxy: boolean;
}

export interface Device {
  name: string;
  entityId: string;
  type: DeviceType;
  sortOrder?: number;
}

export interface DeviceGroup {
  id: string;
  name: string;
  deviceIds: string[];
  sortOrder?: number;
}

export interface DeviceBackup {
  version: 1;
  devices: Device[];
  groups: DeviceGroup[];
}

export interface ServerProfile {
  id: string;
  name: string;
  server: RustServerSettings;
  devices: Device[];
  groups: DeviceGroup[];
  discordWebhookUrl?: string;
}

export interface AppConfig {
  activeServerId: string | null;
  servers: ServerProfile[];
}

export interface FcmConfig {
  fcm_credentials?: {
    gcm?: { androidId?: string; securityToken?: string };
    fcm?: { token?: string };
  };
  expo_push_token?: string;
  rustplus_auth_token?: string;
}

export interface ConnectionStatus {
  connected: boolean;
  message: string;
}

export interface StorageState {
  capacity: number;
  items: Array<StorageItem>;
}

export interface StorageItem {
  itemId: number;
  quantity: number;
  itemIsBlueprint: boolean;
  item?: RustItem;
}

export interface RustItem {
  id: number;
  shortName: string;
  displayName: string;
  iconUrl: string;
}

export interface FcmStatus {
  registered: boolean;
  listening: boolean;
  message: string;
}

export interface PendingPairing {
  id: string;
  serverId: string;
  entityId: string;
  name: string;
  type: DeviceType;
}

export interface RustEvent {
  id: string;
  title: string;
  body: string;
  type: string | number;
  createdAt: string;
  pairingId?: string;
}

export interface SettingsInput {
  server: RustServerSettings & { name: string };
  fcm: FcmConfig;
}
