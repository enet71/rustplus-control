import { Router } from 'express';
import type { Device } from '../types';
import { discordWebhookUrl, isValidationError, settingsInput } from '../validation';
import { RustplusControlService } from '../services/rustplus-control-service';

export function createSettingsRouter(control: RustplusControlService): Router {
  const router = Router();

  router.get('/settings', (_request, response) => {
    const settings = control.getSettings();
    if (!settings)
      return response
        .status(404)
        .json({ error: 'Server and FCM settings must be configured first.' });
    return response.json(settings);
  });
  router.put('/settings', (request, response) => {
    const input = settingsInput(request.body);
    if (isValidationError(input)) return response.status(400).json({ error: input.error });
    const profile = control.getActiveProfile();
    if (!profile) return response.status(404).json({ error: 'No active server.' });
    control.saveFcmSettings(input.fcm);
    control.saveSettings({
      ...profile,
      name: input.server.name,
      server: {
        host: input.server.host,
        port: input.server.port,
        playerId: input.server.playerId,
        playerToken: input.server.playerToken,
        useProxy: input.server.useProxy,
      },
    });
    return response.json({ ok: true });
  });

  router.put('/discord-webhook', (request, response) => {
    const input = discordWebhookUrl(request.body?.url);
    if (isValidationError(input)) return response.status(400).json({ error: input.error });
    if (!control.setDiscordWebhook(input.url))
      return response.status(404).json({ error: 'No active server.' });
    return response.json({ configured: Boolean(input.url) });
  });

  router.put('/config', (request, response) => {
    const value = (request.body || {}) as { server?: Record<string, unknown>; devices?: unknown };
    const server = value.server || {};
    const active = control.getActiveProfile();
    const playerToken = String(server.playerToken || active?.server.playerToken || '');
    if (![server.host, server.port, server.playerId, playerToken].every(Boolean))
      return response
        .status(400)
        .json({ error: 'host, port, Steam64 ID and pairing token are required.' });
    const rawDevices = value.devices === undefined ? active?.devices || [] : value.devices;
    if (
      !Array.isArray(rawDevices) ||
      rawDevices.some(
        (device) =>
          !device ||
          typeof device !== 'object' ||
          !(device as Device).name ||
          !/^-?\d+$/.test(String((device as Device).entityId)),
      )
    )
      return response
        .status(400)
        .json({ error: 'Each device needs a name and numeric entity ID.' });
    const savedDevices: Device[] = rawDevices.map((device, index) => {
      const item = device as Device;
      const existing = active?.devices.find((entry) => entry.entityId === String(item.entityId));
      return {
        name: String(item.name),
        entityId: String(item.entityId),
        type: item.type === 'alarm' ? 'alarm' : 'switch',
        sortOrder: Number.isFinite(Number(existing?.sortOrder))
          ? Number(existing?.sortOrder)
          : index,
      };
    });
    control.saveManualConfig({
      server: {
        host: String(server.host),
        port: String(server.port),
        playerId: String(server.playerId),
        playerToken,
        useProxy: Boolean(server.useProxy),
      },
      devices: savedDevices,
    });
    return response.json({ ok: true });
  });

  return router;
}
