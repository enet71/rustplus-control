import { Router } from 'express';
import { RustplusControlService } from '../services/rustplus-control-service';
import { createDeviceRouter } from './device-routes';
import { createFcmRouter } from './fcm-routes';
import { createSettingsRouter } from './settings-routes';
import { createSystemRouter } from './system-routes';

export function createApiRouter(control: RustplusControlService): Router {
  const router = Router();

  router.use(createSystemRouter(control));
  router.use(createSettingsRouter(control));
  router.use(createFcmRouter(control));
  router.use(createDeviceRouter(control));

  return router;
}
