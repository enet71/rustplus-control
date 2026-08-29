import { readJson, writeJson } from '../../shared/local-storage';

const HIDDEN_NOTE_SOURCES_KEY = 'rustplus-control.hidden-note-sources';

export type NoteSource = 'own' | 'leader';

type HiddenByServer = Record<string, NoteSource[] | undefined>;

export function readHiddenNoteSources(serverId: string): Set<NoteSource> {
  return new Set(readJson<HiddenByServer>(HIDDEN_NOTE_SOURCES_KEY, {})[serverId] || []);
}

export function writeHiddenNoteSources(serverId: string, sources: Set<NoteSource>): void {
  const all = readJson<HiddenByServer>(HIDDEN_NOTE_SOURCES_KEY, {});
  writeJson(HIDDEN_NOTE_SOURCES_KEY, { ...all, [serverId]: [...sources] });
}
