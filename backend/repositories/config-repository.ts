import fs from 'node:fs';
import path from 'node:path';
import type { AppConfig, FcmConfig } from '../types';

export class ConfigRepository {
  readonly configPath: string;
  readonly fcmConfigPath: string;
  readonly legacyFcmConfigPath: string;

  constructor(rootDirectory: string) {
    this.configPath = path.join(rootDirectory, 'data', 'rustplus.json');
    this.fcmConfigPath = path.join(rootDirectory, 'data', 'rustplus-fcm.json');
    this.legacyFcmConfigPath = path.join(rootDirectory, 'rustplus.config.json');
  }

  migrateLegacyFcmConfig(): void {
    if (fs.existsSync(this.fcmConfigPath) || !fs.existsSync(this.legacyFcmConfigPath)) return;
    fs.mkdirSync(path.dirname(this.fcmConfigPath), { recursive: true });
    fs.copyFileSync(this.legacyFcmConfigPath, this.fcmConfigPath);
  }

  loadConfig(): AppConfig {
    try {
      const loaded: unknown = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
      if (this.isAppConfig(loaded)) {
        return {
          activeServerId: loaded.activeServerId || loaded.servers[0]?.id || null,
          // Servers saved before `customMarkers` existed have no such key on disk.
          servers: loaded.servers.map((server) => ({
            ...server,
            customMarkers: server.customMarkers || [],
          })),
          steamApiKey: loaded.steamApiKey || undefined,
        };
      }
      if (this.isLegacyConfig(loaded)) {
        const id = 'legacy-server';
        const migrated: AppConfig = {
          activeServerId: id,
          servers: [
            {
              id,
              name: 'Rust server',
              server: loaded.server,
              devices: loaded.devices || [],
              groups: [],
              customMarkers: [],
            },
          ],
        };
        this.saveConfig(migrated);
        return migrated;
      }
    } catch {
      // Missing or invalid local configuration is equivalent to a fresh install.
    }
    return { activeServerId: null, servers: [] };
  }

  saveConfig(config: AppConfig): void {
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
  }

  loadFcmConfig(): FcmConfig | null {
    try {
      return JSON.parse(fs.readFileSync(this.fcmConfigPath, 'utf8')) as FcmConfig;
    } catch {
      return null;
    }
  }

  saveFcmConfig(config: FcmConfig): void {
    fs.mkdirSync(path.dirname(this.fcmConfigPath), { recursive: true });
    fs.writeFileSync(this.fcmConfigPath, JSON.stringify(config, null, 2), { mode: 0o600 });
  }

  deleteFcmConfigs(): void {
    for (const file of [this.fcmConfigPath, this.legacyFcmConfigPath]) {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
  }

  hasFcmConfig(): boolean {
    return fs.existsSync(this.fcmConfigPath);
  }

  private isAppConfig(value: unknown): value is AppConfig {
    return Boolean(
      value && typeof value === 'object' && Array.isArray((value as AppConfig).servers),
    );
  }

  private isLegacyConfig(value: unknown): value is {
    server: AppConfig['servers'][number]['server'];
    devices?: AppConfig['servers'][number]['devices'];
  } {
    return Boolean(
      value && typeof value === 'object' && (value as { server?: { host?: unknown } }).server?.host,
    );
  }
}
