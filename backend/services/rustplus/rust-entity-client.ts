import { errorSummary, logRust } from './rust-log';

/** Low-level Rust+ entity get/set, shared by direct dashboard commands and team-chat commands. */
export function setRustEntityValue(
  rustplus: any,
  entityId: string,
  enabled: boolean,
): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      rustplus.setEntityValue(entityId, enabled, (message: any) => {
        resolve(!message.response?.error);
        return true;
      });
    } catch (error) {
      logRust(`switch command failed: ${errorSummary(error)}`);
      resolve(false);
    }
  });
}

export function getRustEntityValue(rustplus: any, entityId: string): Promise<boolean | null> {
  return new Promise((resolve) => {
    try {
      rustplus.getEntityInfo(entityId, (message: any) => {
        const value = message.response?.entityInfo?.payload?.value;
        resolve(message.response?.error || typeof value !== 'boolean' ? null : value);
        return true;
      });
    } catch (error) {
      logRust(`team chat state request failed: ${errorSummary(error)}`);
      resolve(null);
    }
  });
}
