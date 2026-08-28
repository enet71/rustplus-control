import crypto from 'node:crypto';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import type { Response } from 'express';
import { ConfigRepository } from '../repositories/config-repository';
import type {
  AppConfig,
  ConnectionStatus,
  Device,
  DeviceBackup,
  DeviceGroup,
  FcmStatus,
  PendingPairing,
  RustEvent,
  ServerProfile,
  StorageState,
} from '../types';
import { RustItemCatalog } from './rust-item-catalog';

const RustPlus: any = require('@liamcottle/rustplus.js');
const RECONNECT_DELAY_MS = 5000;
const DEVICE_STATE_REQUEST_DELAY_MS = 1000;
const DEVICE_STATE_RATE_LIMIT_RETRY_MS = 5000;
const MAP_LOAD_RETRY_MS = 5000;
const STORAGE_POLLING_INTERVAL_MS = 5000;
const TEAM_CHAT_POLLING_INTERVAL_MS = 3000;
const TEAM_CHAT_REQUEST_TIMEOUT_MS = 10000;
const TEAM_CHAT_SEEN_LIMIT = 500;
const TEAM_CHAT_MESSAGE_PREFIX = '[rust-control]';

type SwitchCommandResult = 'not-connected' | 'unknown' | 'no-switches' | 'failed' | null;
type TeamChatRequest = { rustplus: any; timeout: NodeJS.Timeout | null };
type ChatTarget = { name: string; switchIds: string[]; isGroup: boolean };
type MapMarker = { id: string; type: number; x: number; y: number; name: string };
type TeamMapMember = { id: string; name: string; x: number; y: number; isOnline: boolean };
type RustMap = {
  width: number;
  height: number;
  oceanMargin: number;
  mapSize: number;
  image: string;
};

function errorSummary(error: unknown): string {
  const value = error as { name?: unknown; message?: unknown } | null;
  const name = value?.name || 'Error';
  const message = String(value?.message || '')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 240);
  return message ? `${name}: ${message}` : String(name);
}

function logRust(event: string): void {
  console.log(`[rustplus] ${event}`);
}

function isRateLimitError(responseError: unknown): boolean {
  return String((responseError as { error?: unknown } | null)?.error || '')
    .toLowerCase()
    .includes('rate_limit');
}

export class RustplusControlService {
  private readonly fcmCliPath: string;
  private readonly fcmListenerPath: string;
  private client: any = null;
  private status: ConnectionStatus = { connected: false, message: 'Not configured' };
  private config: AppConfig;
  private deviceStates: Record<string, boolean> = {};
  private storageStates: Record<string, StorageState> = {};
  private markerSnapshots = new Map<string, string>();
  private mapMarkers: MapMarker[] = [];
  private teamMapMembers: TeamMapMember[] = [];
  private map: RustMap | null = null;
  private teamDeaths = new Map<string, number>();
  private readonly eventClients = new Set<Response>();
  private markerPolling: NodeJS.Timeout | null = null;
  private teamPolling: NodeJS.Timeout | null = null;
  private teamChatPolling: NodeJS.Timeout | null = null;
  private storagePolling: NodeJS.Timeout | null = null;
  private deviceStateLoadingTimer: NodeJS.Timeout | null = null;
  private mapLoadTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private fcmRegisterProcess: ChildProcess | null = null;
  private fcmListenerProcess: ChildProcess | null = null;
  private fcmStatus: FcmStatus;
  private readonly pendingPairings = new Map<string, PendingPairing>();
  private readonly processedTeamChatMessages = new Set<string>();
  private teamChatRequest: TeamChatRequest | null = null;

  constructor(
    private readonly repository: ConfigRepository,
    private readonly rootDirectory: string,
    private readonly registrationAvailable: boolean,
    private readonly itemCatalog: Pick<RustItemCatalog, 'get' | 'getDeviceIcon'> = {
      get: () => null,
      getDeviceIcon: () => null,
    },
  ) {
    this.repository.migrateLegacyFcmConfig();
    this.config = this.repository.loadConfig();
    this.fcmStatus = {
      registered: this.repository.hasFcmConfig(),
      listening: false,
      message: 'Not registered',
    };
    this.fcmCliPath = path.join(
      rootDirectory,
      'node_modules',
      '@liamcottle',
      'rustplus.js',
      'cli',
      'index.js',
    );
    this.fcmListenerPath = path.join(rootDirectory, 'scripts', 'fcm-listen.js');
  }

  start(): void {
    if (this.fcmStatus.registered) {
      this.startFcmListener();
      this.connect();
    } else {
      this.status = { connected: false, message: 'Log in to connect Rust+' };
    }
  }

  getState(): Record<string, unknown> {
    return {
      ...this.status,
      config: this.publicConfig(),
      deviceStates: this.deviceStates,
      storageStates: this.publicStorageStates(),
      mapMarkers: this.mapMarkers,
      teamMapMembers: this.teamMapMembers,
      mapReady: Boolean(this.map),
    };
  }

  getMap(): RustMap | null {
    return this.map;
  }

  getFcmStatus(): FcmStatus & { registrationAvailable: boolean } {
    return { ...this.fcmStatus, registrationAvailable: this.registrationAvailable };
  }

  getSettings(): Record<string, unknown> | null {
    const profile = this.activeProfile();
    const fcm = this.repository.loadFcmConfig();
    if (!profile || !fcm) return null;
    return {
      server: {
        name: profile.name,
        host: profile.server.host,
        port: profile.server.port,
        playerId: profile.server.playerId,
        playerToken: profile.server.playerToken,
        useProxy: Boolean(profile.server.useProxy),
      },
      fcm: {
        androidId: fcm.fcm_credentials?.gcm?.androidId || '',
        securityToken: fcm.fcm_credentials?.gcm?.securityToken || '',
        token: fcm.fcm_credentials?.fcm?.token || '',
        expoPushToken: fcm.expo_push_token || '',
        rustplusAuthToken: fcm.rustplus_auth_token || '',
      },
    };
  }

  saveSettings(profile: ServerProfile): void {
    this.setActiveProfile(profile);
    this.restartFcmListener();
    this.deviceStates = {};
    this.storageStates = {};
    this.connect();
  }

  saveFcmSettings(fcm: Parameters<ConfigRepository['saveFcmConfig']>[0]): void {
    this.repository.saveFcmConfig(fcm);
  }

  registerFcm(): boolean {
    if (!this.registrationAvailable) return false;
    this.startFcmRegister();
    return true;
  }

  logoutFcm(): void {
    this.cancelReconnect();
    this.stopDeviceStateLoading();
    this.stopStoragePolling();
    this.stopMarkerPolling();
    this.stopTeamPolling();
    this.stopTeamChatPolling();
    this.fcmRegisterProcess?.kill();
    this.fcmListenerProcess?.kill();
    this.fcmRegisterProcess = null;
    this.fcmListenerProcess = null;
    this.repository.deleteFcmConfigs();
    this.pendingPairings.clear();
    if (this.client) this.client.disconnect();
    this.client = null;
    this.deviceStates = {};
    this.storageStates = {};
    this.clearMapState();
    this.status = { connected: false, message: 'Log in to connect Rust+' };
    this.fcmStatus = { registered: false, listening: false, message: 'Not registered' };
  }

  getPendingPairings(): PendingPairing[] {
    return [...this.pendingPairings.values()];
  }

  acceptPairing(id: string, name: string, type: 'switch' | 'alarm'): PendingPairing | null {
    const pairing = this.pendingPairings.get(id);
    if (!pairing) return null;
    const accepted = { ...pairing, name, type };
    this.addPairedDevice(accepted);
    this.pendingPairings.delete(id);
    if (pairing.serverId === this.config.activeServerId) this.connect();
    return accepted;
  }

  rejectPairing(id: string): void {
    this.pendingPairings.delete(id);
  }

  activateServer(id: string): boolean {
    const profile = this.config.servers.find((item) => item.id === id);
    if (!profile) return false;
    this.saveConfig({ ...this.config, activeServerId: profile.id });
    this.deviceStates = {};
    this.storageStates = {};
    this.clearMapState();
    if (this.fcmStatus.registered) this.connect();
    else this.status = { connected: false, message: 'Log in to connect Rust+' };
    return true;
  }

  subscribeEvents(response: Response): void {
    this.eventClients.add(response);
  }

  unsubscribeEvents(response: Response): void {
    this.eventClients.delete(response);
  }

  setDiscordWebhook(url: string): boolean {
    const profile = this.activeProfile();
    if (!profile) return false;
    this.setActiveProfile({ ...profile, discordWebhookUrl: url });
    return true;
  }

  saveManualConfig(input: { server: ServerProfile['server']; devices: Device[] }): void {
    let profile = this.activeProfile();
    if (!profile) {
      profile = {
        id: `manual-${Date.now()}`,
        name: 'Manual server',
        server: input.server,
        devices: [],
        groups: [],
      };
      this.saveConfig({
        ...this.config,
        activeServerId: profile.id,
        servers: [...this.config.servers, profile],
      });
    }
    this.setActiveProfile({
      ...profile,
      server: input.server,
      devices: input.devices,
      groups: this.reconcileGroups(profile.groups, input.devices),
    });
    this.deviceStates = {};
    this.storageStates = {};
    this.connect();
  }

  async setDeviceValue(entityId: string, enabled: boolean): Promise<SwitchCommandResult> {
    if (!this.client || !this.status.connected) return 'not-connected';
    if (
      !(this.activeProfile()?.devices || []).some(
        (device) => device.entityId === entityId && device.type === 'switch',
      )
    )
      return 'unknown';
    const rustplus = this.client;
    if (!(await this.setRustEntityValue(rustplus, entityId, enabled))) return 'failed';
    if (this.client !== rustplus) return 'not-connected';
    this.publishEntityState(entityId, enabled);
    return null;
  }

  renameDevice(entityId: string, name: string): boolean {
    const profile = this.activeProfile();
    if (!profile || !profile.devices.some((device) => device.entityId === entityId)) return false;
    this.setActiveProfile({
      ...profile,
      devices: profile.devices.map((device) =>
        device.entityId === entityId ? { ...device, name } : device,
      ),
    });
    return true;
  }

  exportDeviceBackup(): DeviceBackup | null {
    const profile = this.activeProfile();
    if (!profile) return null;
    return {
      version: 1,
      devices: profile.devices.map((device) => ({ ...device })),
      groups: profile.groups.map((group) => ({ ...group, deviceIds: [...group.deviceIds] })),
    };
  }

  importDeviceBackup(backup: DeviceBackup): boolean {
    const profile = this.activeProfile();
    if (!profile) return false;
    this.setActiveProfile({ ...profile, devices: backup.devices, groups: backup.groups });
    this.deviceStates = {};
    this.storageStates = {};
    this.connect();
    return true;
  }

  createGroup(name: string, deviceIds: string[]): DeviceGroup | null {
    const profile = this.activeProfile();
    if (!profile) return null;
    const group = {
      id: crypto.randomUUID(),
      sortOrder: this.nextSortOrder(profile),
      name,
      deviceIds,
    };
    this.setActiveProfile({ ...profile, groups: [...profile.groups, group] });
    return group;
  }

  updateGroup(id: string, name: string, deviceIds: string[]): boolean {
    const profile = this.activeProfile();
    if (!profile || !profile.groups.some((group) => group.id === id)) return false;
    this.setActiveProfile({
      ...profile,
      groups: profile.groups.map((group) =>
        group.id === id ? { ...group, name, deviceIds } : group,
      ),
    });
    return true;
  }

  deleteGroup(id: string): boolean {
    const profile = this.activeProfile();
    if (!profile || !profile.groups.some((group) => group.id === id)) return false;
    this.setActiveProfile({
      ...profile,
      groups: profile.groups.filter((group) => group.id !== id),
    });
    return true;
  }

  async setGroupValue(id: string, enabled: boolean): Promise<SwitchCommandResult> {
    if (!this.client || !this.status.connected) return 'not-connected';
    const profile = this.activeProfile();
    const group = profile?.groups.find((item) => item.id === id);
    if (!group) return 'unknown';
    const switchIds = group.deviceIds.filter((entityId) =>
      profile?.devices.some((device) => device.entityId === entityId && device.type === 'switch'),
    );
    if (!switchIds.length) return 'no-switches';
    const rustplus = this.client;
    const results = await Promise.all(
      switchIds.map(async (entityId) => ({
        entityId,
        succeeded: await this.setRustEntityValue(rustplus, entityId, enabled),
      })),
    );
    if (this.client !== rustplus) return 'not-connected';
    for (const result of results)
      if (result.succeeded) this.publishEntityState(result.entityId, enabled);
    if (results.some((result) => !result.succeeded)) return 'failed';
    return null;
  }

  /** `order` is validated by `reorderInput` to contain exactly the current top-level item ids. */
  reorderTopLevel(order: Array<{ type: 'group' | 'device'; id: string }>): boolean {
    const profile = this.activeProfile();
    if (!profile) return false;
    const indexById = new Map(order.map((entry, index) => [entry.id, index]));
    this.setActiveProfile({
      ...profile,
      groups: profile.groups.map((group) =>
        indexById.has(group.id) ? { ...group, sortOrder: indexById.get(group.id) } : group,
      ),
      devices: profile.devices.map((device) =>
        indexById.has(device.entityId)
          ? { ...device, sortOrder: indexById.get(device.entityId) }
          : device,
      ),
    });
    return true;
  }

  getActiveProfile(): ServerProfile | null {
    return this.activeProfile();
  }

  private activeProfile(): ServerProfile | null {
    return this.config.servers.find((server) => server.id === this.config.activeServerId) || null;
  }

  private saveConfig(config: AppConfig): void {
    this.repository.saveConfig(config);
    this.config = config;
  }

  private setActiveProfile(profile: ServerProfile): void {
    this.saveConfig({
      ...this.config,
      activeServerId: profile.id,
      servers: this.config.servers.map((item) => (item.id === profile.id ? profile : item)),
    });
  }

  private publicConfig(): Record<string, unknown> {
    const profile = this.activeProfile();
    const { playerToken: _playerToken, ...server } =
      profile?.server || ({} as ServerProfile['server']);
    return {
      server: { ...server, hasPlayerToken: Boolean(profile?.server.playerToken) },
      devices: (profile?.devices || []).map((device) => ({
        ...device,
        iconUrl: this.itemCatalog.getDeviceIcon(device.type)?.iconUrl,
      })),
      groups: profile?.groups || [],
      discordConfigured: Boolean(profile?.discordWebhookUrl),
      activeServerId: this.config.activeServerId,
      servers: this.config.servers.map((item) => ({
        id: item.id,
        name: item.name,
        host: item.server.host,
        connected: item.id === this.config.activeServerId && this.status.connected,
      })),
    };
  }

  private publicStorageStates(): Record<string, StorageState> {
    return Object.fromEntries(
      Object.entries(this.storageStates).map(([entityId, storage]) => [
        entityId,
        {
          ...storage,
          items: storage.items.map((item) => ({
            ...item,
            item: this.itemCatalog.get(item.itemId) || undefined,
          })),
        },
      ]),
    );
  }

  private clearMapState(): void {
    this.stopMapLoading();
    this.map = null;
    this.mapMarkers = [];
    this.teamMapMembers = [];
  }

  private reconcileGroups(groups: DeviceGroup[], devices: Device[]): DeviceGroup[] {
    const deviceIds = new Set(devices.map((device) => device.entityId));
    return groups
      .map((group) => ({
        ...group,
        deviceIds: [...new Set(group.deviceIds.filter((id) => deviceIds.has(id)))],
      }))
      .filter((group) => group.deviceIds.length > 0);
  }

  private sortOrder(item: { sortOrder?: number }, fallback: number): number {
    const value = Number(item.sortOrder);
    return Number.isFinite(value) ? value : fallback;
  }

  private nextSortOrder(profile: ServerProfile): number {
    return (
      Math.max(
        -1,
        ...[...profile.groups, ...profile.devices].map((item, index) =>
          this.sortOrder(item, index),
        ),
      ) + 1
    );
  }

  private publishEntityState(entityId: string, value: boolean): void {
    this.deviceStates[String(entityId)] = Boolean(value);
  }

  private publishStorageState(
    entityId: string,
    payload: { capacity?: unknown; items?: unknown },
  ): void {
    if (!Array.isArray(payload.items)) return;
    const items = payload.items.map((item: any) => ({
      itemId: Number(item.itemId),
      quantity: Number(item.quantity),
      itemIsBlueprint: Boolean(item.itemIsBlueprint),
    }));
    const capacity = Number(payload.capacity);
    this.storageStates[String(entityId)] = {
      capacity: Number.isFinite(capacity)
        ? capacity
        : (this.storageStates[String(entityId)]?.capacity ?? 0),
      items,
    };
  }

  private refreshStorageState(rustplus: any, entityId: string): void {
    try {
      rustplus.getEntityInfo(String(entityId), (message: any) => {
        if (this.client !== rustplus) return true;
        if (!message.response?.error)
          this.publishStorageState(entityId, message.response?.entityInfo?.payload || {});
        return true;
      });
    } catch (error) {
      logRust(`storage state refresh failed: ${errorSummary(error)}`);
    }
  }

  private handleEntityChanged(rustplus: any, message: any): void {
    const changed = message.broadcast?.entityChanged;
    const payload = changed?.payload;
    if (!changed || !payload) return;
    const entityId = String(changed.entityId);
    const device = this.activeProfile()?.devices.find((item) => item.entityId === entityId);
    if (device?.type === 'storage') {
      if (Array.isArray(payload.items)) this.publishStorageState(entityId, payload);
      // Pipe changes may only emit an on/off pulse, without an item payload.
      else if (payload.value === false) this.refreshStorageState(rustplus, entityId);
      return;
    }
    if (typeof payload.value !== 'boolean') return;
    const wasActive = this.deviceStates[entityId];
    this.publishEntityState(entityId, payload.value);
    if (device?.type === 'alarm' && payload.value && !wasActive) {
      this.publishEvent({
        id: `${entityId}:${Date.now()}`,
        title: 'Smart Alarm',
        body: `${device.name} was triggered`,
        type: 'alarm',
        createdAt: new Date().toISOString(),
      });
      void this.sendDiscordAlarm(this.activeProfile(), device);
    }
  }

  private publishEvent(event: RustEvent): void {
    const payload = `event: rust-event\ndata: ${JSON.stringify(event)}\n\n`;
    for (const response of this.eventClients) response.write(payload);
  }

  private addPairedDevice(pairing: PendingPairing): void {
    const profile = this.config.servers.find((item) => item.id === pairing.serverId);
    if (profile && !profile.devices.some((device) => device.entityId === pairing.entityId))
      this.saveConfig({
        ...this.config,
        servers: this.config.servers.map((item) =>
          item.id === profile.id
            ? {
                ...profile,
                devices: [
                  ...profile.devices,
                  {
                    name: pairing.name,
                    entityId: pairing.entityId,
                    type: pairing.type,
                    sortOrder: this.nextSortOrder(profile),
                  },
                ],
              }
            : item,
        ),
      });
  }

  private handlePairing(data: any): void {
    const bodyValue = data.appData?.find((item: any) => item.key === 'body')?.value;
    if (!bodyValue) return;
    let pairing: any;
    try {
      pairing = JSON.parse(bodyValue);
    } catch {
      return;
    }
    if (pairing.type === 'server') {
      const id = String(pairing.id || `${pairing.ip}:${pairing.port}`);
      const existing = this.config.servers.find((item) => item.id === id);
      const profile: ServerProfile = {
        id,
        name: pairing.name || pairing.ip,
        server: {
          host: String(pairing.ip),
          port: String(pairing.port),
          playerId: String(pairing.playerId),
          playerToken: String(pairing.playerToken),
          useProxy: false,
        },
        devices: existing?.devices || [],
        groups: existing?.groups || [],
      };
      this.saveConfig({
        ...this.config,
        activeServerId: id,
        servers: [...this.config.servers.filter((item) => item.id !== id), profile],
      });
      this.publishEvent({
        id: `pair-server:${Date.now()}`,
        title: 'Rust+ server paired',
        body: pairing.name || pairing.ip,
        type: 'pairing',
        createdAt: new Date().toISOString(),
      });
      this.connect();
    }
    if (pairing.type === 'entity' && pairing.entityId) {
      const entityId = String(pairing.entityId);
      const serverId = String(pairing.id || this.config.activeServerId || '');
      const profile = this.config.servers.find((item) => item.id === serverId);
      if (!profile || profile.devices.some((device) => device.entityId === entityId)) return;
      const pending: PendingPairing = {
        id: `${entityId}:${Date.now()}`,
        serverId,
        entityId,
        name: pairing.entityName || 'Smart device',
        type:
          String(pairing.entityType) === '2'
            ? 'alarm'
            : String(pairing.entityType) === '3'
              ? 'storage'
              : 'switch',
      };
      this.pendingPairings.set(pending.id, pending);
      this.publishEvent({
        id: pending.id,
        title: 'New Rust+ device',
        body: pending.name,
        type: 'pairing-device',
        pairingId: pending.id,
        createdAt: new Date().toISOString(),
      });
    }
  }

  private startFcmListener(): void {
    if (this.fcmListenerProcess) return;
    const listener = spawn(
      process.execPath,
      [this.fcmListenerPath, this.repository.fcmConfigPath],
      { cwd: this.rootDirectory },
    );
    this.fcmListenerProcess = listener;
    listener.on('error', (error) => {
      logRust(`FCM listener failed to start: ${errorSummary(error)}`);
      if (this.fcmListenerProcess === listener) this.fcmListenerProcess = null;
      this.fcmStatus = { registered: true, listening: false, message: 'Listener failed to start' };
    });
    this.fcmStatus = {
      registered: true,
      listening: true,
      message: 'Listening for Rust+ pairing notifications',
    };
    let buffer = '';
    listener.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        try {
          this.handlePairing(JSON.parse(line));
        } catch {
          /* Ignore non-JSON listener output. */
        }
      }
    });
    listener.stderr?.on('data', (chunk: Buffer) => {
      if (this.fcmListenerProcess === listener)
        this.fcmStatus.message = `Listener error: ${chunk.toString().trim()}`;
    });
    listener.on('close', (code) => {
      if (this.fcmListenerProcess !== listener) return;
      this.fcmListenerProcess = null;
      this.fcmStatus = {
        registered: this.repository.hasFcmConfig(),
        listening: false,
        message: `Listener stopped (${code ?? 'unknown'})`,
      };
    });
  }

  private restartFcmListener(): void {
    const previous = this.fcmListenerProcess;
    if (!previous) {
      this.startFcmListener();
      return;
    }
    this.fcmListenerProcess = null;
    this.fcmStatus = { registered: true, listening: false, message: 'Restarting FCM listener' };
    previous.once('close', () => this.startFcmListener());
    if (!previous.kill()) this.startFcmListener();
  }

  private startFcmRegister(): void {
    if (this.repository.hasFcmConfig()) {
      this.fcmStatus = {
        registered: true,
        listening: Boolean(this.fcmListenerProcess),
        message: 'Rust+ is already registered',
      };
      this.startFcmListener();
      return;
    }
    if (this.fcmRegisterProcess) return;
    this.fcmRegisterProcess = spawn(
      process.execPath,
      [this.fcmCliPath, `--config-file=${this.repository.fcmConfigPath}`, 'fcm-register'],
      { cwd: this.rootDirectory },
    );
    this.fcmRegisterProcess.on('error', (error) => {
      logRust(`FCM registration failed to start: ${errorSummary(error)}`);
      this.fcmRegisterProcess = null;
      this.fcmStatus = {
        registered: false,
        listening: false,
        message: 'Registration failed to start',
      };
    });
    this.fcmStatus = {
      registered: false,
      listening: false,
      message: 'Chrome is opening for Steam sign-in',
    };
    this.fcmRegisterProcess.stderr?.on('data', (chunk: Buffer) => {
      this.fcmStatus.message = `Registration error: ${chunk.toString().trim()}`;
    });
    this.fcmRegisterProcess.on('close', (code) => {
      this.fcmRegisterProcess = null;
      if (code === 0 && this.repository.hasFcmConfig()) {
        this.fcmStatus = { registered: true, listening: false, message: 'Registration complete' };
        this.startFcmListener();
        this.connect();
      } else
        this.fcmStatus = {
          registered: false,
          listening: false,
          message: `Registration stopped (${code ?? 'unknown'})`,
        };
    });
  }

  private startMarkerPolling(): void {
    this.stopMarkerPolling();
    this.markerSnapshots = new Map();
    const poll = () => {
      if (!this.client || !this.status.connected) return;
      this.client.getMapMarkers((message: any) => {
        const markers = message.response?.mapMarkers?.markers;
        if (!Array.isArray(markers)) return true;
        this.mapMarkers = markers
          .map((marker: any) => ({
            id: String(marker.id),
            type: Number(marker.type),
            x: Number(marker.x),
            y: Number(marker.y),
            name: String(marker.name || ''),
          }))
          .filter((marker: MapMarker) => Number.isFinite(marker.x) && Number.isFinite(marker.y));
        const next = new Map(
          markers.map((marker: any) => [
            String(marker.id),
            JSON.stringify({
              type: marker.type,
              name: marker.name,
              outOfStock: marker.outOfStock,
              sellOrders: marker.sellOrders,
            }),
          ]),
        );
        if (this.markerSnapshots.size)
          for (const marker of markers) {
            const id = String(marker.id);
            const previous = this.markerSnapshots.get(id);
            const changedVending = marker.type === 3 && previous && previous !== next.get(id);
            const newEvent = !previous && [3, 4, 5, 8].includes(marker.type);
            if (changedVending || newEvent)
              this.publishEvent({
                id: `${id}:${Date.now()}`,
                title:
                  (
                    {
                      3: 'Vending machine',
                      4: 'CH47',
                      5: 'Cargo Ship',
                      8: 'Patrol Helicopter',
                    } as Record<number, string>
                  )[marker.type] || 'Map event',
                body: changedVending
                  ? `${marker.name || 'Offers'} changed`
                  : 'New event detected on the map',
                type: marker.type,
                createdAt: new Date().toISOString(),
              });
          }
        this.markerSnapshots = next;
        return true;
      });
    };
    poll();
    this.markerPolling = setInterval(poll, 10000);
  }

  private stopMarkerPolling(): void {
    if (this.markerPolling) clearInterval(this.markerPolling);
    this.markerPolling = null;
  }

  private startTeamPolling(): void {
    this.stopTeamPolling();
    this.teamDeaths = new Map();
    const poll = () => {
      if (!this.client || !this.status.connected) return;
      this.client.getTeamInfo((message: any) => {
        const members = message.response?.teamInfo?.members;
        if (!Array.isArray(members)) return true;
        this.teamMapMembers = members
          .map((member: any) => ({
            id: String(member.steamId),
            name: String(member.name || 'Teammate'),
            x: Number(member.x),
            y: Number(member.y),
            isOnline: Boolean(member.isOnline),
          }))
          .filter(
            (member: TeamMapMember) => Number.isFinite(member.x) && Number.isFinite(member.y),
          );
        const next = new Map(
          members.map((member: any) => [String(member.steamId), Number(member.deathTime || 0)]),
        );
        if (this.teamDeaths.size)
          for (const member of members) {
            const previous = this.teamDeaths.get(String(member.steamId)) || 0;
            const deathTime = Number(member.deathTime || 0);
            if (!member.isAlive && deathTime > previous)
              this.publishEvent({
                id: `${member.steamId}:${deathTime}`,
                title: 'Player death',
                body: `${member.name} died`,
                type: 'player-death',
                createdAt: new Date().toISOString(),
              });
          }
        this.teamDeaths = next;
        return true;
      });
    };
    poll();
    this.teamPolling = setInterval(poll, 10000);
  }

  private stopTeamPolling(): void {
    if (this.teamPolling) clearInterval(this.teamPolling);
    this.teamPolling = null;
  }

  private loadMap(rustplus: any): void {
    this.stopMapLoading();
    try {
      rustplus.getInfo((infoMessage: any) => {
        if (this.client !== rustplus) return true;
        if (isRateLimitError(infoMessage.response?.error)) {
          this.scheduleMapRetry(rustplus);
          return true;
        }
        const mapSize = Number(infoMessage.response?.info?.mapSize);
        if (infoMessage.response?.error || !Number.isFinite(mapSize) || mapSize <= 0) return true;
        rustplus.getMap((message: any) => {
          if (this.client !== rustplus) return true;
          if (isRateLimitError(message.response?.error)) {
            this.scheduleMapRetry(rustplus);
            return true;
          }
          if (message.response?.error) return true;
          const map = message.response?.map;
          const width = Number(map?.width);
          const height = Number(map?.height);
          if (!map?.jpgImage || !Number.isFinite(width) || !Number.isFinite(height)) return true;
          this.map = {
            width,
            height,
            oceanMargin: Number.isFinite(Number(map.oceanMargin)) ? Number(map.oceanMargin) : 0,
            mapSize,
            image: `data:image/jpeg;base64,${Buffer.from(map.jpgImage).toString('base64')}`,
          };
          return true;
        });
        return true;
      });
    } catch (error) {
      logRust(`map request failed: ${errorSummary(error)}`);
    }
  }

  private scheduleMapRetry(rustplus: any): void {
    this.stopMapLoading();
    this.mapLoadTimer = setTimeout(() => {
      this.mapLoadTimer = null;
      if (this.client === rustplus) this.loadMap(rustplus);
    }, MAP_LOAD_RETRY_MS);
  }

  private stopMapLoading(): void {
    if (this.mapLoadTimer) clearTimeout(this.mapLoadTimer);
    this.mapLoadTimer = null;
  }

  private startTeamChatPolling(rustplus: any): void {
    this.stopTeamChatPolling();
    const poll = () => {
      if (this.client !== rustplus || !this.status.connected || this.teamChatRequest) return;
      const request: TeamChatRequest = { rustplus, timeout: null };
      this.teamChatRequest = request;
      request.timeout = setTimeout(() => {
        if (!this.finishTeamChatRequest(request)) return;
        logRust('team chat poll timed out');
      }, TEAM_CHAT_REQUEST_TIMEOUT_MS);
      try {
        rustplus.sendRequest({ getTeamChat: {} }, (message: any) => {
          if (!this.finishTeamChatRequest(request)) return true;
          if (this.client !== rustplus || message.response?.error) return true;
          const messages = message.response?.teamChat?.messages;
          if (!Array.isArray(messages)) return true;
          for (const teamMessage of messages) this.handleTeamChatMessage(rustplus, teamMessage);
          return true;
        });
      } catch (error) {
        this.finishTeamChatRequest(request);
        logRust(`team chat poll failed: ${errorSummary(error)}`);
      }
    };
    poll();
    this.teamChatPolling = setInterval(poll, TEAM_CHAT_POLLING_INTERVAL_MS);
  }

  private stopTeamChatPolling(): void {
    if (this.teamChatPolling) clearInterval(this.teamChatPolling);
    this.teamChatPolling = null;
    if (this.teamChatRequest?.timeout) clearTimeout(this.teamChatRequest.timeout);
    this.teamChatRequest = null;
  }

  private finishTeamChatRequest(request: TeamChatRequest): boolean {
    if (this.teamChatRequest !== request) return false;
    if (request.timeout) clearTimeout(request.timeout);
    this.teamChatRequest = null;
    return true;
  }

  private handleTeamChatMessage(rustplus: any, teamMessage: any): void {
    const text = typeof teamMessage?.message === 'string' ? teamMessage.message : '';
    const messageId = [teamMessage?.steamId, teamMessage?.time, text].join(':');
    if (!text.startsWith('!') || this.processedTeamChatMessages.has(messageId)) return;
    this.processedTeamChatMessages.add(messageId);
    if (this.processedTeamChatMessages.size > TEAM_CHAT_SEEN_LIMIT)
      this.processedTeamChatMessages.delete(this.processedTeamChatMessages.values().next().value!);

    const command = text.slice(1).trim();
    const action = command.endsWith('+') ? true : command.endsWith('-') ? false : null;
    const targetName = (action === null ? command : command.slice(0, -1)).trim();
    if (!targetName) return;
    const targets = this.findChatTargets(targetName);
    if (!targets.length) {
      this.sendTeamChatMessage(rustplus, `Switch or group not found: ${targetName}.`);
      return;
    }
    if (targets.length > 1) {
      this.sendTeamChatMessage(
        rustplus,
        `Multiple switches or groups have the name: ${targetName}.`,
      );
      return;
    }
    if (action === null) void this.sendChatTargetState(rustplus, targets[0]);
    else void this.setChatTargetValue(rustplus, targets[0], action);
  }

  private findChatTargets(name: string): ChatTarget[] {
    const profile = this.activeProfile();
    const normalizedName = name.toLocaleLowerCase();
    if (!profile) return [];
    const switches = profile.devices.filter(
      (device) => device.type === 'switch' && device.name.toLocaleLowerCase() === normalizedName,
    );
    const groups = profile.groups
      .filter((group) => group.name.toLocaleLowerCase() === normalizedName)
      .map((group) => ({
        name: group.name,
        switchIds: group.deviceIds.filter((entityId) =>
          profile.devices.some(
            (device) => device.entityId === entityId && device.type === 'switch',
          ),
        ),
        isGroup: true,
      }))
      .filter((group) => group.switchIds.length);
    return [
      ...switches.map((device) => ({
        name: device.name,
        switchIds: [device.entityId],
        isGroup: false,
      })),
      ...groups,
    ];
  }

  private async sendChatTargetState(rustplus: any, target: ChatTarget): Promise<void> {
    const targetLabel = this.chatTargetLabel(target);
    const results = await Promise.all(
      target.switchIds.map(async (entityId) => ({
        entityId,
        value: await this.getRustEntityValue(rustplus, entityId),
      })),
    );
    if (this.client !== rustplus) return;
    const failedIds = results
      .filter((result) => result.value === null)
      .map((result) => result.entityId);
    if (failedIds.length) {
      this.sendTeamChatMessage(
        rustplus,
        `Unable to get state: ${targetLabel} (failed: ${failedIds.join(', ')}).`,
      );
      return;
    }
    for (const result of results) this.publishEntityState(result.entityId, result.value!);
    this.sendTeamChatMessage(
      rustplus,
      `${targetLabel}: ${results.every((result) => result.value) ? 'on' : 'off'}.`,
    );
  }

  private async setChatTargetValue(
    rustplus: any,
    target: ChatTarget,
    enabled: boolean,
  ): Promise<void> {
    const targetLabel = this.chatTargetLabel(target);
    const results = await Promise.all(
      target.switchIds.map(async (entityId) => ({
        entityId,
        succeeded: await this.setRustEntityValue(rustplus, entityId, enabled),
      })),
    );
    if (this.client !== rustplus) return;
    for (const result of results)
      if (result.succeeded) this.publishEntityState(result.entityId, enabled);
    const failedIds = results
      .filter((result) => !result.succeeded)
      .map((result) => result.entityId);
    if (failedIds.length) {
      this.sendTeamChatMessage(
        rustplus,
        `${targetLabel}: ${results.length - failedIds.length}/${results.length} switches changed; failed: ${failedIds.join(', ')}.`,
      );
      return;
    }
    this.sendTeamChatMessage(rustplus, `${targetLabel}: ${enabled ? 'on' : 'off'}.`);
  }

  private chatTargetLabel(target: ChatTarget): string {
    return target.isGroup ? `Group ${target.name}` : target.name;
  }

  private setRustEntityValue(rustplus: any, entityId: string, enabled: boolean): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        rustplus.setEntityValue(entityId, enabled, (message: any) => {
          resolve(!message.response?.error);
          return true;
        });
      } catch (error) {
        logRust(`switch command failed: ${errorSummary(error)}`);
        resolve(false);
      }
    });
  }

  private getRustEntityValue(rustplus: any, entityId: string): Promise<boolean | null> {
    return new Promise((resolve) => {
      try {
        rustplus.getEntityInfo(entityId, (message: any) => {
          const value = message.response?.entityInfo?.payload?.value;
          resolve(message.response?.error || typeof value !== 'boolean' ? null : value);
          return true;
        });
      } catch (error) {
        logRust(`team chat state request failed: ${errorSummary(error)}`);
        resolve(null);
      }
    });
  }

  private sendTeamChatMessage(rustplus: any, message: string): void {
    if (this.client !== rustplus || !this.status.connected) return;
    try {
      rustplus.sendTeamMessage(`${TEAM_CHAT_MESSAGE_PREFIX} ${message}`);
    } catch (error) {
      logRust(`team chat reply failed: ${errorSummary(error)}`);
    }
  }

  private startStoragePolling(rustplus: any, devices: Device[]): void {
    this.stopStoragePolling();
    const storageDevices = devices.filter((device) => device.type === 'storage');
    if (!storageDevices.length) return;
    const poll = () => {
      if (this.client !== rustplus || !this.status.connected) return;
      for (const device of storageDevices) this.refreshStorageState(rustplus, device.entityId);
    };
    poll();
    this.storagePolling = setInterval(poll, STORAGE_POLLING_INTERVAL_MS);
  }

  private stopStoragePolling(): void {
    if (this.storagePolling) clearInterval(this.storagePolling);
    this.storagePolling = null;
  }

  private cancelReconnect(): void {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private stopDeviceStateLoading(): void {
    if (this.deviceStateLoadingTimer) clearTimeout(this.deviceStateLoadingTimer);
    this.deviceStateLoadingTimer = null;
  }

  private startPollingListeners(rustplus: any, devices: Device[]): void {
    this.loadMap(rustplus);
    this.startMarkerPolling();
    this.startTeamPolling();
    this.startTeamChatPolling(rustplus);
    this.startStoragePolling(rustplus, devices);
  }

  private loadDeviceStates(rustplus: any, devices: Device[]): void {
    this.stopDeviceStateLoading();
    const pending = [...devices];
    const total = pending.length;
    logRust(`device state queue started: ${total} device(s)`);
    const scheduleNext = (delay: number, requestNext: () => void) => {
      this.deviceStateLoadingTimer = setTimeout(() => {
        this.deviceStateLoadingTimer = null;
        requestNext();
      }, delay);
    };
    const requestNext = () => {
      if (this.client !== rustplus || !this.status.connected) return;
      const device = pending[0];
      if (!device) {
        logRust(`device state queue completed: ${total} device(s)`);
        return;
      }
      const requestNumber = total - pending.length + 1;
      logRust(`device state request ${requestNumber}/${total}`);
      try {
        rustplus.getEntityInfo(String(device.entityId), (message: any) => {
          if (this.client !== rustplus) return true;
          const responseError = message.response?.error;
          if (responseError) {
            logRust(
              `device state response error ${requestNumber}/${total}: ${errorSummary({ name: 'Rust+ response', message: responseError.error })}`,
            );
            if (isRateLimitError(responseError)) {
              scheduleNext(DEVICE_STATE_RATE_LIMIT_RETRY_MS, requestNext);
              return true;
            }
          }
          const payload = message.response?.entityInfo?.payload;
          if (device.type === 'storage') this.publishStorageState(device.entityId, payload || {});
          else if (typeof payload?.value === 'boolean')
            this.publishEntityState(device.entityId, payload.value);
          pending.shift();
          if (pending.length) scheduleNext(DEVICE_STATE_REQUEST_DELAY_MS, requestNext);
          else logRust(`device state queue completed: ${total} device(s)`);
          return true;
        });
      } catch (error) {
        logRust(`device state request failed ${requestNumber}/${total}: ${errorSummary(error)}`);
        pending.shift();
        if (pending.length) scheduleNext(DEVICE_STATE_REQUEST_DELAY_MS, requestNext);
        else logRust(`device state queue completed: ${total} device(s)`);
      }
    };
    requestNext();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const server = this.activeProfile()?.server;
    if (!server || ![server.host, server.port, server.playerId, server.playerToken].every(Boolean))
      return;
    this.status = {
      connected: false,
      message: `Disconnected. Retrying in ${RECONNECT_DELAY_MS / 1000} seconds...`,
    };
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, RECONNECT_DELAY_MS);
  }

  private connect(): void {
    this.cancelReconnect();
    this.stopDeviceStateLoading();
    this.stopStoragePolling();
    this.stopMarkerPolling();
    this.stopTeamPolling();
    this.stopTeamChatPolling();
    this.clearMapState();
    if (this.client) {
      const previous = this.client;
      this.client = null;
      previous.disconnect();
    }
    const profile = this.activeProfile();
    const server = profile?.server;
    if (
      !server ||
      ![server.host, server.port, server.playerId, server.playerToken].every(Boolean)
    ) {
      this.status = { connected: false, message: 'Enter Rust+ server credentials' };
      return;
    }
    this.status = { connected: false, message: 'Connecting...' };
    logRust('connecting');
    const rustplus = new RustPlus(
      server.host,
      String(server.port),
      String(server.playerId),
      String(server.playerToken),
      Boolean(server.useProxy),
    );
    this.client = rustplus;
    rustplus.on('connected', () => {
      if (this.client !== rustplus) return;
      this.cancelReconnect();
      this.status = { connected: true, message: 'Connected' };
      logRust('connected');
      this.startPollingListeners(rustplus, profile.devices);
      this.loadDeviceStates(rustplus, profile.devices);
    });
    rustplus.on('connecting', () => {
      if (this.client === rustplus) this.status = { connected: false, message: 'Connecting...' };
    });
    rustplus.on('disconnected', () => {
      if (this.client !== rustplus) return;
      logRust(`disconnected; retrying in ${RECONNECT_DELAY_MS / 1000}s`);
      this.stopDeviceStateLoading();
      this.stopStoragePolling();
      this.stopMarkerPolling();
      this.stopTeamPolling();
      this.stopTeamChatPolling();
      this.scheduleReconnect();
    });
    rustplus.on('error', (error: Error) => {
      if (this.client !== rustplus) return;
      logRust(`socket error: ${errorSummary(error)}`);
      this.status = { connected: false, message: `Connection error: ${error.message}` };
      this.stopStoragePolling();
      this.stopMarkerPolling();
      this.stopTeamPolling();
      this.stopTeamChatPolling();
      this.scheduleReconnect();
    });
    rustplus.on('message', (message: any) => {
      if (this.client !== rustplus) return;
      this.handleEntityChanged(rustplus, message);
    });
    rustplus.connect();
  }

  private async sendDiscordAlarm(profile: ServerProfile | null, device: Device): Promise<void> {
    const url = profile?.discordWebhookUrl;
    if (!url) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: `@everyone Alarm triggered: ${device.name}${profile?.name ? ` (${profile.name})` : ''}`,
          allowed_mentions: { parse: ['everyone'] },
        }),
        signal: controller.signal,
      });
      if (!response.ok) logRust(`Discord alarm notification failed (${response.status})`);
    } catch (error) {
      logRust(`Discord alarm notification failed: ${(error as Error)?.name || 'Error'}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}
