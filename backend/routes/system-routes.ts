import { Router } from 'express';
import { RustplusControlService } from '../services/rustplus-control-service';

export function createSystemRouter(control: RustplusControlService): Router {
  const router = Router();

  router.get('/auth/verify', (_request, response) => response.json({ authenticated: true }));
  router.get('/state', (_request, response) => response.json(control.getState()));
  router.get('/map', (_request, response) => {
    const map = control.getMap();
    return map
      ? response.json(map)
      : response.status(409).json({ error: 'Map is not available yet.' });
  });

  router.get('/events', (request, response) => {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    response.write(': connected\n\n');
    control.subscribeEvents(response);
    request.on('close', () => control.unsubscribeEvents(response));
  });

  return router;
}
