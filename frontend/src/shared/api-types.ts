export type DeviceType = 'switch' | 'alarm' | 'storage';

export type Device = {
  entityId: string;
  name: string;
  type: DeviceType;
  sortOrder?: number;
  iconUrl?: string;
};

export type DeviceGroup = {
  id: string;
  name: string;
  deviceIds: string[];
  sortOrder?: number;
};

export type StorageItem = {
  itemId: number;
  quantity: number;
  item?: { displayName?: string; iconUrl?: string };
};

export type StorageState = { capacity: number; items: StorageItem[] };

export type CustomMarker = {
  id: string;
  name: string;
  description: string;
  x: number;
  y: number;
};

export type DashboardState = {
  connected: boolean;
  message: string;
  deviceStates: Record<string, boolean | undefined>;
  storageStates: Record<string, StorageState | undefined>;
  mapMarkers: MapPoint[];
  mapNotes: Array<MapPoint & { source: 'own' | 'leader' }>;
  teamMapMembers: Array<
    MapPoint & { id: string; name: string; isOnline: boolean; avatarUrl?: string }
  >;
  deathMarkers: Array<{
    id: string;
    playerId: string;
    name: string;
    x: number;
    y: number;
    deathTime: number;
  }>;
  config: {
    activeServerId?: string;
    servers: Array<{ id: string; name: string }>;
    devices: Device[];
    groups: DeviceGroup[];
    customMarkers: CustomMarker[];
    discordConfigured: boolean;
  };
};

export type MapPoint = { id: string; x: number; y: number; type?: number; name?: string };

export type RustMonument = { token: string; x: number; y: number };

export type RustMap = {
  width: number;
  height: number;
  oceanMargin: number;
  mapSize: number;
  image: string;
  monuments: RustMonument[];
};

export type AppEvent = {
  id: string;
  title: string;
  body: string;
  type: string | number;
  createdAt: string;
};

export type FcmStatus = {
  registrationAvailable: boolean;
  registered: boolean;
  listening: boolean;
  message: string;
};

export type PendingPairing = {
  id: string;
  entityId: string;
  name: string;
  type: DeviceType;
};

export type Settings = {
  server: {
    name: string;
    host: string;
    port: string;
    playerId: string;
    playerToken: string;
    useProxy: boolean;
  };
  fcm: Record<
    'androidId' | 'securityToken' | 'token' | 'expoPushToken' | 'rustplusAuthToken',
    string
  >;
  steamApiKey: string;
};
