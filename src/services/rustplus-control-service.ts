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
  RustItem,
  ServerProfile,
  StorageState,
} from '../types';
import { RustItemCatalog } from './rust-item-catalog';

const RustPlus: any = require('@liamcottle/rustplus.js');
const RECONNECT_DELAY_MS = 5000;
const DEVICE_STATE_REQUEST_DELAY_MS = 200;
const STORAGE_POLLING_INTERVAL_MS = 5000;

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

export class RustplusControlService {
  private readonly fcmCliPath: string;
  private readonly fcmListenerPath: string;
  private client: any = null;
  private status: ConnectionStatus = { connected: false, message: 'Not configured' };
  private config: AppConfig;
  private deviceStates: Record<string, boolean> = {};
  private storageStates: Record<string, StorageState> = {};
  private markerSnapshots = new Map<string, string>();
  private teamDeaths = new Map<string, number>();
  private readonly eventClients = new Set<Response>();
  private markerPolling: NodeJS.Timeout | null = null;
  private teamPolling: NodeJS.Timeout | null = null;
  private storagePolling: NodeJS.Timeout | null = null;
  private deviceStateLoadingTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private fcmRegisterProcess: ChildProcess | null = null;
  private fcmListenerProcess: ChildProcess | null = null;
  private fcmStatus: FcmStatus;
  private readonly pendingPairings = new Map<string, PendingPairing>();

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
    };
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

  setDeviceValue(entityId: string, enabled: boolean): 'not-connected' | 'unknown' | null {
    if (!this.client || !this.status.connected) return 'not-connected';
    if (
      !(this.activeProfile()?.devices || []).some(
        (device) => device.entityId === entityId && device.type === 'switch',
      )
    )
      return 'unknown';
    this.client.setEntityValue(entityId, enabled, (message: any) => {
      if (!message.response?.error) this.publishEntityState(entityId, enabled);
    });
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

  setGroupValue(id: string, enabled: boolean): 'not-connected' | 'unknown' | 'no-switches' | null {
    if (!this.client || !this.status.connected) return 'not-connected';
    const profile = this.activeProfile();
    const group = profile?.groups.find((item) => item.id === id);
    if (!group) return 'unknown';
    const switchIds = group.deviceIds.filter((entityId) =>
      profile?.devices.some((device) => device.entityId === entityId && device.type === 'switch'),
    );
    if (!switchIds.length) return 'no-switches';
    for (const entityId of switchIds)
      this.client.setEntityValue(entityId, enabled, (message: any) => {
        if (!message.response?.error) this.publishEntityState(entityId, enabled);
      });
    return null;
  }

  moveItem(type: 'group' | 'device', id: string, direction: -1 | 1): boolean {
    const profile = this.activeProfile();
    if (!profile) return false;
    const next = this.moveProfileItem(profile, type, id, direction);
    if (!next) return false;
    this.setActiveProfile(next);
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
  private moveProfileItem(
    profile: ServerProfile,
    type: 'group' | 'device',
    id: string,
    direction: -1 | 1,
  ): ServerProfile | null {
    const parent =
      type === 'device' ? profile.groups.find((group) => group.deviceIds.includes(id)) : null;
    const items = parent
      ? parent.deviceIds
          .map((entityId, index) => ({
            item: profile.devices.find((device) => device.entityId === entityId),
            index,
          }))
          .filter((entry): entry is { item: Device; index: number } => Boolean(entry.item))
      : [
          ...profile.groups.map((item, index) => ({ item, index })),
          ...profile.devices
            .filter(
              (device) =>
                !profile.groups.some((group) => group.deviceIds.includes(device.entityId)),
            )
            .map((item, index) => ({ item, index: profile.groups.length + index })),
        ];
    const ordered = [...items].sort(
      (left, right) =>
        this.sortOrder(left.item, left.index) - this.sortOrder(right.item, right.index),
    );
    const position = ordered.findIndex(
      (entry) => ('id' in entry.item ? entry.item.id : entry.item.entityId) === id,
    );
    const target = position + direction;
    if (position < 0 || target < 0 || target >= ordered.length) return null;
    [ordered[position], ordered[target]] = [ordered[target], ordered[position]];
    const orderById = new Map(
      ordered.map((entry, index) => [
        'id' in entry.item ? entry.item.id : entry.item.entityId,
        index,
      ]),
    );
    return {
      ...profile,
      groups: profile.groups.map((group) =>
        orderById.has(group.id) ? { ...group, sortOrder: orderById.get(group.id) } : group,
      ),
      devices: profile.devices.map((device) =>
        orderById.has(device.entityId)
          ? { ...device, sortOrder: orderById.get(device.entityId) }
          : device,
      ),
    };
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
    console.log(rustplus, message);
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
    if (this.markerPolling) clearInterval(this.markerPolling);
    this.markerSnapshots = new Map();
    const poll = () => {
      if (!this.client || !this.status.connected) return;
      this.client.getMapMarkers((message: any) => {
        const markers = message.response?.mapMarkers?.markers;
        if (!Array.isArray(markers)) return true;
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
  private startTeamPolling(): void {
    if (this.teamPolling) clearInterval(this.teamPolling);
    this.teamDeaths = new Map();
    const poll = () => {
      if (!this.client || !this.status.connected) return;
      this.client.getTeamInfo((message: any) => {
        const members = message.response?.teamInfo?.members;
        if (!Array.isArray(members)) return true;
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
  private loadDeviceStates(rustplus: any, devices: Device[]): void {
    this.stopDeviceStateLoading();
    const pending = [...devices];
    const total = pending.length;
    let requested = 0;
    logRust(`device state queue started: ${total} device(s)`);
    const requestNext = () => {
      if (this.client !== rustplus || !this.status.connected) return;
      const device = pending.shift();
      if (!device) return;
      requested += 1;
      const requestNumber = requested;
      logRust(`device state request ${requestNumber}/${total}`);
      try {
        rustplus.getEntityInfo(String(device.entityId), (message: any) => {
          if (this.client !== rustplus) return true;
          if (message.response?.error)
            logRust(
              `device state response error ${requestNumber}/${total}: ${errorSummary({ name: 'Rust+ response', message: message.response.error.error })}`,
            );
          const payload = message.response?.entityInfo?.payload;
          if (device.type === 'storage') this.publishStorageState(device.entityId, payload || {});
          else if (typeof payload?.value === 'boolean')
            this.publishEntityState(device.entityId, payload.value);
          return true;
        });
      } catch (error) {
        logRust(`device state request failed ${requestNumber}/${total}: ${errorSummary(error)}`);
      }
      if (pending.length)
        this.deviceStateLoadingTimer = setTimeout(requestNext, DEVICE_STATE_REQUEST_DELAY_MS);
      else logRust(`device state queue completed: ${total} device(s)`);
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
      this.loadDeviceStates(rustplus, profile.devices);
      this.startStoragePolling(rustplus, profile.devices);
      this.startMarkerPolling();
      this.startTeamPolling();
    });
    rustplus.on('connecting', () => {
      if (this.client === rustplus) this.status = { connected: false, message: 'Connecting...' };
    });
    rustplus.on('disconnected', () => {
      if (this.client !== rustplus) return;
      logRust(`disconnected; retrying in ${RECONNECT_DELAY_MS / 1000}s`);
      this.stopDeviceStateLoading();
      this.stopStoragePolling();
      if (this.markerPolling) clearInterval(this.markerPolling);
      if (this.teamPolling) clearInterval(this.teamPolling);
      this.scheduleReconnect();
    });
    rustplus.on('error', (error: Error) => {
      if (this.client !== rustplus) return;
      logRust(`socket error: ${errorSummary(error)}`);
      this.status = { connected: false, message: `Connection error: ${error.message}` };
      this.stopStoragePolling();
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
