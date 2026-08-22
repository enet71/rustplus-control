import crypto from 'node:crypto';
import path from 'node:path';
import express from 'express';
import { ConfigRepository } from './repositories/config-repository';
import { createApiRouter } from './routes/api-router';
import { RustplusControlService } from './services/rustplus-control-service';

const rootDirectory = path.resolve(__dirname, '..');
const port = Number(process.env.PORT || 3010);
const host = process.env.HOST || '127.0.0.1';
const authToken = process.env.APP_AUTH_TOKEN;

if (!authToken) throw new Error('APP_AUTH_TOKEN must be set before starting Rust+ Control.');

const app = express();
const control = new RustplusControlService(
  new ConfigRepository(rootDirectory),
  rootDirectory,
  process.env.NODE_ENV !== 'production',
);

process.on('uncaughtExceptionMonitor', (error, origin) => {
  const message = String(error.message || '')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 240);
  console.log(`[rustplus] fatal ${origin}: ${error.name}${message ? `: ${message}` : ''}`);
});

app.use(express.json());
app.use(express.static(path.join(rootDirectory, 'public')));
app.use('/api', (request, response, next) => {
  const authorization = request.get('authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : '';
  const expected = Buffer.from(authToken);
  const received = Buffer.from(token);
  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected))
    return response.status(401).json({ error: 'Authentication required.' });
  response.set('Cache-Control', 'no-store');
  return next();
});
app.use('/api', createApiRouter(control));

app.listen(port, host, () => {
  console.log(`Rust+ Control is running at http://${host}:${port}`);
  control.start();
});
