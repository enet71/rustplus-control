import { Router } from 'express';
import { RustplusControlService } from '../services/rustplus-control-service';

export function createFcmRouter(control: RustplusControlService): Router {
  const router = Router();

  router.get('/fcm/status', (_request, response) => response.json(control.getFcmStatus()));
  router.post('/fcm/register', (_request, response) => {
    if (!control.registerFcm())
      return response
        .status(403)
        .json({ error: 'Rust+ registration is available only on a local installation.' });
    return response.status(202).json({ ok: true });
  });
  router.post('/fcm/logout', (_request, response) => {
    control.logoutFcm();
    response.json({ ok: true });
  });

  router.get('/pairings/pending', (_request, response) =>
    response.json(control.getPendingPairings()),
  );
  router.post('/pairings/:id/accept', (request, response) => {
    const pending = control.getPendingPairings().find((item) => item.id === request.params.id);
    if (!pending) return response.status(404).json({ error: 'Pairing request expired.' });
    const name = String(request.body?.name || pending.name).trim();
    if (!name) return response.status(400).json({ error: 'Device name is required.' });
    control.acceptPairing(pending.id, name, request.body?.type === 'alarm' ? 'alarm' : 'switch');
    return response.json({ ok: true });
  });
  router.delete('/pairings/:id', (request, response) => {
    control.rejectPairing(request.params.id);
    response.status(204).end();
  });

  router.post('/servers/:id/activate', (request, response) =>
    control.activateServer(request.params.id)
      ? response.json({ ok: true })
      : response.status(404).json({ error: 'Unknown server.' }),
  );

  return router;
}
