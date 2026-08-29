import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import type { FcmStatus } from '../../types';
import { errorSummary, logRust } from './rust-log';

/**
 * Owns the FCM `fcm-register` / `fcm-listen` child processes and their lifecycle.
 * Pairing payloads parsed from the listener's stdout are handed to `onPairingLine`;
 * this class has no knowledge of server/device config, only of the two processes.
 */
export class FcmProcessManager {
  private readonly fcmCliPath: string;
  private readonly fcmListenerPath: string;
  private fcmRegisterProcess: ChildProcess | null = null;
  private fcmListenerProcess: ChildProcess | null = null;
  private status: FcmStatus;

  constructor(
    private readonly rootDirectory: string,
    private readonly fcmConfigPath: string,
    private readonly hasFcmConfig: () => boolean,
    private readonly onPairingLine: (data: unknown) => void,
    initiallyRegistered: boolean,
  ) {
    this.fcmCliPath = path.join(
      rootDirectory,
      'node_modules',
      '@liamcottle',
      'rustplus.js',
      'cli',
      'index.js',
    );
    this.fcmListenerPath = path.join(rootDirectory, 'scripts', 'fcm-listen.js');
    this.status = {
      registered: initiallyRegistered,
      listening: false,
      message: 'Not registered',
    };
  }

  getStatus(): FcmStatus {
    return { ...this.status };
  }

  startListener(): void {
    if (this.fcmListenerProcess) return;
    const listener = spawn(process.execPath, [this.fcmListenerPath, this.fcmConfigPath], {
      cwd: this.rootDirectory,
    });
    this.fcmListenerProcess = listener;
    listener.on('error', (error) => {
      logRust(`FCM listener failed to start: ${errorSummary(error)}`);
      if (this.fcmListenerProcess === listener) this.fcmListenerProcess = null;
      this.status = { registered: true, listening: false, message: 'Listener failed to start' };
    });
    this.status = {
      registered: true,
      listening: true,
      message: 'Listening for Rust+ pairing notifications',
    };
    let buffer = '';
    listener.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        try {
          this.onPairingLine(JSON.parse(line));
        } catch {
          /* Ignore non-JSON listener output. */
        }
      }
    });
    listener.stderr?.on('data', (chunk: Buffer) => {
      if (this.fcmListenerProcess === listener)
        this.status.message = `Listener error: ${chunk.toString().trim()}`;
    });
    listener.on('close', (code) => {
      if (this.fcmListenerProcess !== listener) return;
      this.fcmListenerProcess = null;
      this.status = {
        registered: this.hasFcmConfig(),
        listening: false,
        message: `Listener stopped (${code ?? 'unknown'})`,
      };
    });
  }

  restartListener(): void {
    const previous = this.fcmListenerProcess;
    if (!previous) {
      this.startListener();
      return;
    }
    this.fcmListenerProcess = null;
    this.status = { registered: true, listening: false, message: 'Restarting FCM listener' };
    previous.once('close', () => this.startListener());
    if (!previous.kill()) this.startListener();
  }

  /** Calls `onRegistered` only when a *fresh* registration completed successfully. */
  startRegister(onRegistered: () => void): void {
    if (this.hasFcmConfig()) {
      this.status = {
        registered: true,
        listening: Boolean(this.fcmListenerProcess),
        message: 'Rust+ is already registered',
      };
      this.startListener();
      return;
    }
    if (this.fcmRegisterProcess) return;
    this.fcmRegisterProcess = spawn(
      process.execPath,
      [this.fcmCliPath, `--config-file=${this.fcmConfigPath}`, 'fcm-register'],
      { cwd: this.rootDirectory },
    );
    this.fcmRegisterProcess.on('error', (error) => {
      logRust(`FCM registration failed to start: ${errorSummary(error)}`);
      this.fcmRegisterProcess = null;
      this.status = {
        registered: false,
        listening: false,
        message: 'Registration failed to start',
      };
    });
    this.status = {
      registered: false,
      listening: false,
      message: 'Chrome is opening for Steam sign-in',
    };
    this.fcmRegisterProcess.stderr?.on('data', (chunk: Buffer) => {
      this.status.message = `Registration error: ${chunk.toString().trim()}`;
    });
    this.fcmRegisterProcess.on('close', (code) => {
      this.fcmRegisterProcess = null;
      if (code === 0 && this.hasFcmConfig()) {
        this.status = { registered: true, listening: false, message: 'Registration complete' };
        this.startListener();
        onRegistered();
      } else
        this.status = {
          registered: false,
          listening: false,
          message: `Registration stopped (${code ?? 'unknown'})`,
        };
    });
  }

  stopAll(): void {
    this.fcmRegisterProcess?.kill();
    this.fcmListenerProcess?.kill();
    this.fcmRegisterProcess = null;
    this.fcmListenerProcess = null;
    this.status = { registered: false, listening: false, message: 'Not registered' };
  }
}
