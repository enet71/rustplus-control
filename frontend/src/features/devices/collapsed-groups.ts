import { readJson, writeJson } from '../../shared/local-storage';

const COLLAPSED_KEY = 'rustplus-control.collapsed-groups';

type CollapsedByServer = Record<string, string[] | undefined>;

export function readCollapsedGroups(serverId: string): Set<string> {
  return new Set(readJson<CollapsedByServer>(COLLAPSED_KEY, {})[serverId] || []);
}

export function writeCollapsedGroups(serverId: string, groups: Set<string>): void {
  const all = readJson<CollapsedByServer>(COLLAPSED_KEY, {});
  writeJson(COLLAPSED_KEY, { ...all, [serverId]: [...groups] });
}
