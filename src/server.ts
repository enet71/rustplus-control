import crypto from 'node:crypto';
import path from 'node:path';
import express, { type ErrorRequestHandler } from 'express';
import { ConfigRepository } from './repositories/config-repository';
import { createApiRouter } from './routes/api-router';
import { RustItemCatalog } from './services/rust-item-catalog';
import { RustplusControlService } from './services/rustplus-control-service';

const rootDirectory = path.resolve(__dirname, '..');
const port = Number(process.env.PORT || 3010);
const host = process.env.HOST || '127.0.0.1';
const authToken = process.env.APP_AUTH_TOKEN;

if (!authToken) throw new Error('APP_AUTH_TOKEN must be set before starting Rust+ Control.');

function errorSummary(error: unknown): string {
  const value = error as { name?: unknown; message?: unknown } | null;
  const name = String(value?.name || 'Error');
  const message = String(value?.message || '')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 240);
  return message ? `${name}: ${message}` : name;
}

function logUnhandledError(source: string, error: unknown): void {
  console.error(`[rustplus] ${source}: ${errorSummary(error)}`);
}

const app = express();
const itemCatalog = new RustItemCatalog();
const control = new RustplusControlService(
  new ConfigRepository(rootDirectory),
  rootDirectory,
  process.env.NODE_ENV !== 'production',
  itemCatalog,
);

process.on('uncaughtException', (error, origin) => {
  logUnhandledError(`uncaught exception (${origin})`, error);
});
process.on('unhandledRejection', (reason) => {
  logUnhandledError('unhandled rejection', reason);
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
const apiErrorHandler: ErrorRequestHandler = (error, request, response, next) => {
  logUnhandledError(`${request.method} ${request.originalUrl}`, error);
  if (response.headersSent) return next(error);
  const status = error instanceof SyntaxError && 'body' in error ? 400 : 500;
  return response
    .status(status)
    .json({ error: status === 400 ? 'Invalid JSON body.' : 'Request failed.' });
};
app.use('/api', apiErrorHandler);

app.listen(port, host, () => {
  console.log(`Rust+ Control is running at http://${host}:${port}`);
  itemCatalog.start();
  control.start();
});
