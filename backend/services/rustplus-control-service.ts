import crypto from 'node:crypto';
import type { Response } from 'express';
import { ConfigRepository } from '../repositories/config-repository';
import type {
  AppConfig,
  ConnectionStatus,
  CustomMarker,
  Device,
  DeviceBackup,
  DeviceGroup,
  FcmStatus,
  PendingPairing,
  RustEvent,
  ServerProfile,
} from '../types';
import { RustItemCatalog } from './rust-item-catalog';
import { DeviceStateService } from './rustplus/device-state-service';
import { postDiscordAlarm } from './rustplus/discord-notifier';
import { FcmProcessManager } from './rustplus/fcm-process-manager';
import { setRustEntityValue } from './rustplus/rust-entity-client';
import { errorSummary, logRust } from './rustplus/rust-log';
import { TeamChatCommandService } from './rustplus/team-chat-command-service';
import { WorldStateService, type RustMap } from './rustplus/world-state-service';

const RustPlus: any = require('@liamcottle/rustplus.js');
const RECONNECT_DELAY_MS = 5000;

type SwitchCommandResult = 'not-connected' | 'unknown' | 'no-switches' | 'failed' | null;

export class RustplusControlService {
  private client: any = null;
  private status: ConnectionStatus = { connected: false, message: 'Not configured' };
  private config: AppConfig;
  private readonly eventClients = new Set<Response>();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private readonly pendingPairings = new Map<string, PendingPairing>();

  private readonly fcmProcess: FcmProcessManager;
  private readonly worldState: WorldStateService;
  private readonly deviceState: DeviceStateService;
  private readonly teamChat: TeamChatCommandService;

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
    this.fcmProcess = new FcmProcessManager(
      rootDirectory,
      this.repository.fcmConfigPath,
      () => this.repository.hasFcmConfig(),
      (data) => this.handlePairing(data),
      this.repository.hasFcmConfig(),
    );
    this.worldState = new WorldStateService(
      () => this.client,
      () => this.status,
      (event) => this.publishEvent(event),
      () => this.config.steamApiKey,
    );
    this.deviceState = new DeviceStateService(
      () => this.client,
      () => this.status,
      this.itemCatalog,
    );
    this.teamChat = new TeamChatCommandService(
      () => this.activeProfile(),
      () => this.client,
      () => this.status,
      (entityId, value) => this.deviceState.publishEntityState(entityId, value),
    );
  }

  start(): void {
    if (this.fcmProcess.getStatus().registered) {
      this.fcmProcess.startListener();
      this.connect();
    } else {
      this.status = { connected: false, message: 'Log in to connect Rust+' };
    }
  }

  getState(): Record<string, unknown> {
    return {
      ...this.status,
      config: this.publicConfig(),
      deviceStates: this.deviceState.getDeviceStates(),
      storageStates: this.deviceState.publicStorageStates(),
      mapMarkers: this.worldState.getMapMarkers(),
      mapNotes: this.worldState.getMapNotes(),
      teamMapMembers: this.worldState.getTeamMapMembers(),
      deathMarkers: this.worldState.getDeathMarkers(),
      mapReady: Boolean(this.worldState.getMap()),
    };
  }

  getMap(): RustMap | null {
    return this.worldState.getMap();
  }

  getFcmStatus(): FcmStatus & { registrationAvailable: boolean } {
    return { ...this.fcmProcess.getStatus(), registrationAvailable: this.registrationAvailable };
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
      steamApiKey: this.config.steamApiKey || '',
    };
  }

  saveSteamApiKey(steamApiKey: string): void {
    this.saveConfig({ ...this.config, steamApiKey: steamApiKey || undefined });
  }

  saveSettings(profile: ServerProfile): void {
    this.setActiveProfile(profile);
    this.fcmProcess.restartListener();
    this.deviceState.reset();
    this.connect();
  }

  saveFcmSettings(fcm: Parameters<ConfigRepository['saveFcmConfig']>[0]): void {
    this.repository.saveFcmConfig(fcm);
  }

  registerFcm(): boolean {
    if (!this.registrationAvailable) return false;
    this.fcmProcess.startRegister(() => this.connect());
    return true;
  }

  logoutFcm(): void {
    this.cancelReconnect();
    this.deviceState.stopDeviceStateLoading();
    this.deviceState.stopStoragePolling();
    this.worldState.stopMarkerPolling();
    this.worldState.stopTeamPolling();
    this.teamChat.stopTeamChatPolling();
    this.fcmProcess.stopAll();
    this.repository.deleteFcmConfigs();
    this.pendingPairings.clear();
    if (this.client) this.client.disconnect();
    this.client = null;
    this.deviceState.reset();
    this.worldState.clearMapState();
    this.worldState.clearDeathHistory();
    this.status = { connected: false, message: 'Log in to connect Rust+' };
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
    this.deviceState.reset();
    this.worldState.clearMapState();
    this.worldState.clearDeathHistory();
    if (this.fcmProcess.getStatus().registered) this.connect();
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
        customMarkers: [],
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
    this.deviceState.reset();
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
    if (!(await setRustEntityValue(rustplus, entityId, enabled))) return 'failed';
    if (this.client !== rustplus) return 'not-connected';
    this.deviceState.publishEntityState(entityId, enabled);
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

  deleteDevice(entityId: string): boolean {
    const profile = this.activeProfile();
    if (!profile || !profile.devices.some((device) => device.entityId === entityId)) return false;
    const devices = profile.devices.filter((device) => device.entityId !== entityId);
    this.setActiveProfile({
      ...profile,
      devices,
      groups: this.reconcileGroups(profile.groups, devices),
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
    this.deviceState.reset();
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

  createCustomMarker(name: string, description: string, x: number, y: number): CustomMarker | null {
    const profile = this.activeProfile();
    if (!profile) return null;
    const marker: CustomMarker = { id: crypto.randomUUID(), name, description, x, y };
    this.setActiveProfile({
      ...profile,
      customMarkers: [...(profile.customMarkers || []), marker],
    });
    return marker;
  }

  updateCustomMarker(id: string, name: string, description: string): boolean {
    const profile = this.activeProfile();
    if (!profile || !(profile.customMarkers || []).some((marker) => marker.id === id)) return false;
    this.setActiveProfile({
      ...profile,
      customMarkers: (profile.customMarkers || []).map((marker) =>
        marker.id === id ? { ...marker, name, description } : marker,
      ),
    });
    return true;
  }

  deleteCustomMarker(id: string): boolean {
    const profile = this.activeProfile();
    if (!profile || !(profile.customMarkers || []).some((marker) => marker.id === id)) return false;
    this.setActiveProfile({
      ...profile,
      customMarkers: (profile.customMarkers || []).filter((marker) => marker.id !== id),
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
        succeeded: await setRustEntityValue(rustplus, entityId, enabled),
      })),
    );
    if (this.client !== rustplus) return 'not-connected';
    for (const result of results)
      if (result.succeeded) this.deviceState.publishEntityState(result.entityId, enabled);
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
      customMarkers: profile?.customMarkers || [],
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

  private handleEntityChanged(rustplus: any, message: any): void {
    const changed = message.broadcast?.entityChanged;
    const payload = changed?.payload;
    if (!changed || !payload) return;
    const entityId = String(changed.entityId);
    const device = this.activeProfile()?.devices.find((item) => item.entityId === entityId);
    if (device?.type === 'storage') {
      if (Array.isArray(payload.items)) this.deviceState.publishStorageState(entityId, payload);
      // Pipe changes may only emit an on/off pulse, without an item payload.
      else if (payload.value === false) this.deviceState.refreshStorageState(rustplus, entityId);
      return;
    }
    if (typeof payload.value !== 'boolean') return;
    const wasActive = this.deviceState.getDeviceState(entityId);
    this.deviceState.publishEntityState(entityId, payload.value);
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
        customMarkers: existing?.customMarkers || [],
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

  private cancelReconnect(): void {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private startPollingListeners(rustplus: any, devices: Device[]): void {
    this.worldState.loadMap(rustplus);
    this.worldState.startMarkerPolling();
    this.worldState.startTeamPolling();
    this.teamChat.startTeamChatPolling(rustplus);
    this.deviceState.startStoragePolling(rustplus, devices);
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
    this.deviceState.stopDeviceStateLoading();
    this.deviceState.stopStoragePolling();
    this.worldState.stopMarkerPolling();
    this.worldState.stopTeamPolling();
    this.teamChat.stopTeamChatPolling();
    this.worldState.clearMapState();
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
      this.deviceState.loadDeviceStates(rustplus, profile.devices);
    });
    rustplus.on('connecting', () => {
      if (this.client === rustplus) this.status = { connected: false, message: 'Connecting...' };
    });
    rustplus.on('disconnected', () => {
      if (this.client !== rustplus) return;
      logRust(`disconnected; retrying in ${RECONNECT_DELAY_MS / 1000}s`);
      this.deviceState.stopDeviceStateLoading();
      this.deviceState.stopStoragePolling();
      this.worldState.stopMarkerPolling();
      this.worldState.stopTeamPolling();
      this.teamChat.stopTeamChatPolling();
      this.scheduleReconnect();
    });
    rustplus.on('error', (error: Error) => {
      if (this.client !== rustplus) return;
      logRust(`socket error: ${errorSummary(error)}`);
      this.status = { connected: false, message: `Connection error: ${error.message}` };
      this.deviceState.stopStoragePolling();
      this.worldState.stopMarkerPolling();
      this.worldState.stopTeamPolling();
      this.teamChat.stopTeamChatPolling();
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
    await postDiscordAlarm(
      url,
      `@everyone Alarm triggered: ${device.name}${profile?.name ? ` (${profile.name})` : ''}`,
    );
  }
}
