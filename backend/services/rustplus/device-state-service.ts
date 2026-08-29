import type { ConnectionStatus, Device, StorageState } from '../../types';
import type { RustItemCatalog } from '../rust-item-catalog';
import { errorSummary, isRateLimitError, logRust } from './rust-log';

const DEVICE_STATE_REQUEST_DELAY_MS = 1000;
const DEVICE_STATE_RATE_LIMIT_RETRY_MS = 5000;
const STORAGE_POLLING_INTERVAL_MS = 5000;

/** Switch/alarm on-off state and Storage Monitor contents, kept current by broadcasts
 *  (`applyEntityChange`, wired from the socket's `message` event) and by polling. */
export class DeviceStateService {
  private deviceStates: Record<string, boolean> = {};
  private storageStates: Record<string, StorageState> = {};
  private storagePolling: NodeJS.Timeout | null = null;
  private deviceStateLoadingTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly getClient: () => any,
    private readonly getStatus: () => ConnectionStatus,
    private readonly itemCatalog: Pick<RustItemCatalog, 'get'>,
  ) {}

  reset(): void {
    this.deviceStates = {};
    this.storageStates = {};
  }

  getDeviceStates(): Record<string, boolean> {
    return this.deviceStates;
  }

  getDeviceState(entityId: string): boolean | undefined {
    return this.deviceStates[entityId];
  }

  publishEntityState(entityId: string, value: boolean): void {
    this.deviceStates[String(entityId)] = Boolean(value);
  }

  publicStorageStates(): Record<string, StorageState> {
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

  publishStorageState(entityId: string, payload: { capacity?: unknown; items?: unknown }): void {
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

  refreshStorageState(rustplus: any, entityId: string): void {
    try {
      rustplus.getEntityInfo(String(entityId), (message: any) => {
        if (this.getClient() !== rustplus) return true;
        if (!message.response?.error)
          this.publishStorageState(entityId, message.response?.entityInfo?.payload || {});
        return true;
      });
    } catch (error) {
      logRust(`storage state refresh failed: ${errorSummary(error)}`);
    }
  }

  startStoragePolling(rustplus: any, devices: Device[]): void {
    this.stopStoragePolling();
    const storageDevices = devices.filter((device) => device.type === 'storage');
    if (!storageDevices.length) return;
    const poll = () => {
      if (this.getClient() !== rustplus || !this.getStatus().connected) return;
      for (const device of storageDevices) this.refreshStorageState(rustplus, device.entityId);
    };
    poll();
    this.storagePolling = setInterval(poll, STORAGE_POLLING_INTERVAL_MS);
  }

  stopStoragePolling(): void {
    if (this.storagePolling) clearInterval(this.storagePolling);
    this.storagePolling = null;
  }

  stopDeviceStateLoading(): void {
    if (this.deviceStateLoadingTimer) clearTimeout(this.deviceStateLoadingTimer);
    this.deviceStateLoadingTimer = null;
  }

  loadDeviceStates(rustplus: any, devices: Device[]): void {
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
      if (this.getClient() !== rustplus || !this.getStatus().connected) return;
      const device = pending[0];
      if (!device) {
        logRust(`device state queue completed: ${total} device(s)`);
        return;
      }
      const requestNumber = total - pending.length + 1;
      logRust(`device state request ${requestNumber}/${total}`);
      try {
        rustplus.getEntityInfo(String(device.entityId), (message: any) => {
          if (this.getClient() !== rustplus) return true;
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
}
