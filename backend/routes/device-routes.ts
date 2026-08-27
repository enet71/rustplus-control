import { Router } from 'express';
import { deviceBackupInput, groupInput, isValidationError } from '../validation';
import { RustplusControlService } from '../services/rustplus-control-service';

export function createDeviceRouter(control: RustplusControlService): Router {
  const router = Router();

  router.get('/device-backup', (_request, response) => {
    const backup = control.exportDeviceBackup();
    if (!backup) return response.status(404).json({ error: 'No active server.' });
    return response.json(backup);
  });
  router.post('/device-backup', (request, response) => {
    const backup = deviceBackupInput(request.body);
    if (isValidationError(backup)) return response.status(400).json({ error: backup.error });
    if (!control.importDeviceBackup(backup))
      return response.status(404).json({ error: 'No active server.' });
    return response.json({ ok: true });
  });

  router.post('/devices/:entityId', async (request, response) => {
    const enabled = request.body?.enabled;
    if (typeof enabled !== 'boolean')
      return response.status(400).json({ error: 'enabled must be boolean.' });
    const result = await control.setDeviceValue(String(request.params.entityId), enabled);
    if (result === 'not-connected')
      return response.status(409).json({ error: 'Rust+ is not connected.' });
    if (result === 'unknown') return response.status(404).json({ error: 'Unknown switch.' });
    if (result === 'failed')
      return response.status(502).json({ error: 'Rust+ rejected the command.' });
    return response.json({ ok: true });
  });
  router.patch('/devices/:entityId', (request, response) => {
    const name = String(request.body?.name || '').trim();
    if (!name || name.length > 80)
      return response
        .status(400)
        .json({ error: 'Device name must be between 1 and 80 characters.' });
    return control.renameDevice(String(request.params.entityId), name)
      ? response.json({ ok: true })
      : response.status(404).json({ error: 'Unknown device.' });
  });

  router.post('/groups', (request, response) => {
    const profile = control.getActiveProfile();
    if (!profile) return response.status(404).json({ error: 'No active server.' });
    const input = groupInput(request.body, profile);
    if (isValidationError(input)) return response.status(400).json({ error: input.error });
    const group = control.createGroup(input.name, input.deviceIds);
    return response.status(201).json({ group });
  });
  router.patch('/groups/:id', (request, response) => {
    const profile = control.getActiveProfile();
    if (!profile) return response.status(404).json({ error: 'No active server.' });
    if (!profile.groups.some((group) => group.id === request.params.id))
      return response.status(404).json({ error: 'Unknown group.' });
    const input = groupInput(request.body, profile, request.params.id);
    if (isValidationError(input)) return response.status(400).json({ error: input.error });
    control.updateGroup(request.params.id, input.name, input.deviceIds);
    return response.json({ ok: true });
  });
  router.delete('/groups/:id', (request, response) => {
    if (!control.getActiveProfile())
      return response.status(404).json({ error: 'No active server.' });
    return control.deleteGroup(request.params.id)
      ? response.status(204).end()
      : response.status(404).json({ error: 'Unknown group.' });
  });
  router.post('/groups/:id/switch', async (request, response) => {
    const enabled = request.body?.enabled;
    if (typeof enabled !== 'boolean')
      return response.status(400).json({ error: 'enabled must be boolean.' });
    const result = await control.setGroupValue(request.params.id, enabled);
    if (result === 'not-connected')
      return response.status(409).json({ error: 'Rust+ is not connected.' });
    if (result === 'unknown') return response.status(404).json({ error: 'Unknown group.' });
    if (result === 'no-switches')
      return response.status(409).json({ error: 'This group does not contain a switch.' });
    if (result === 'failed')
      return response.status(502).json({ error: 'Rust+ rejected one or more group commands.' });
    return response.json({ ok: true });
  });

  router.post('/items/:type/:id/move', (request, response) => {
    const type = request.params.type;
    const direction = request.body?.direction;
    if ((type !== 'group' && type !== 'device') || (direction !== -1 && direction !== 1))
      return response.status(400).json({ error: 'type and direction are invalid.' });
    if (!control.getActiveProfile())
      return response.status(404).json({ error: 'No active server.' });
    return control.moveItem(type, request.params.id, direction)
      ? response.json({ ok: true })
      : response.status(409).json({ error: 'Item cannot be moved further.' });
  });

  return router;
}
