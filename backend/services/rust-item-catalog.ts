import type { DeviceType, RustItem } from '../types';

const ITEM_LIST_URL = 'https://rusthelp.com/downloads/admin-item-list-public.json';
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;

const DEVICE_SHORT_NAMES: Record<DeviceType, string> = {
  switch: 'smart.switch',
  alarm: 'smart.alarm',
  storage: 'storage.monitor',
};

function isCatalogIconUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.hostname === 'cdn.rusthelp.com' &&
      url.pathname.startsWith('/images/public/')
    );
  } catch {
    return false;
  }
}

function catalogItem(value: unknown): RustItem | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (
    typeof item.id !== 'number' ||
    !Number.isSafeInteger(item.id) ||
    typeof item.shortName !== 'string' ||
    typeof item.displayName !== 'string' ||
    !isCatalogIconUrl(item.iconUrl)
  )
    return null;
  return {
    id: item.id,
    shortName: item.shortName,
    displayName: item.displayName,
    iconUrl: item.iconUrl,
  };
}

export class RustItemCatalog {
  private byId = new Map<number, RustItem>();
  private byShortName = new Map<string, RustItem>();

  start(): void {
    void this.refresh();
    const refreshTimer = setInterval(() => void this.refresh(), REFRESH_INTERVAL_MS);
    refreshTimer.unref();
  }

  get(itemId: number): RustItem | null {
    return this.byId.get(itemId) || null;
  }

  getDeviceIcon(type: DeviceType): RustItem | null {
    return this.byShortName.get(DEVICE_SHORT_NAMES[type]) || null;
  }

  async refresh(): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(ITEM_LIST_URL, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload: unknown = await response.json();
      if (!Array.isArray(payload)) throw new Error('Expected an array');

      const items = payload.map(catalogItem).filter((item): item is RustItem => Boolean(item));
      if (!items.length) throw new Error('No valid items');

      this.byId = new Map(items.map((item) => [item.id, item]));
      this.byShortName = new Map(items.map((item) => [item.shortName, item]));
      console.log(`[rustplus] Rust item catalog loaded: ${items.length} items`);
    } catch (error) {
      console.log(`[rustplus] Rust item catalog unavailable: ${(error as Error).name || 'Error'}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}
