import { readJson, writeJson } from '../../shared/local-storage';

const TEAM_PANEL_OPEN_KEY = 'rustplus-control.team-panel-open';

type OpenByServer = Record<string, boolean | undefined>;

export function readTeamPanelOpen(serverId: string): boolean {
  const stored = readJson<OpenByServer>(TEAM_PANEL_OPEN_KEY, {})[serverId];
  return stored === undefined ? true : stored;
}

export function writeTeamPanelOpen(serverId: string, open: boolean): void {
  const all = readJson<OpenByServer>(TEAM_PANEL_OPEN_KEY, {});
  writeJson(TEAM_PANEL_OPEN_KEY, { ...all, [serverId]: open });
}
