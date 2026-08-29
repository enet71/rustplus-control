import { readJson, writeJson } from '../../shared/local-storage';

const HIDDEN_PLAYERS_KEY = 'rustplus-control.hidden-players';

type HiddenByServer = Record<string, string[] | undefined>;

export function readHiddenPlayers(serverId: string): Set<string> {
  return new Set(readJson<HiddenByServer>(HIDDEN_PLAYERS_KEY, {})[serverId] || []);
}

export function writeHiddenPlayers(serverId: string, ids: Set<string>): void {
  const all = readJson<HiddenByServer>(HIDDEN_PLAYERS_KEY, {});
  writeJson(HIDDEN_PLAYERS_KEY, { ...all, [serverId]: [...ids] });
}
