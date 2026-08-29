import type { ConnectionStatus, RustEvent } from '../../types';
import { errorSummary, isRateLimitError, logRust } from './rust-log';

const MAP_LOAD_RETRY_MS = 5000;
/** AppMarkerType.Player: teammates already come from getTeamInfo, so map markers exclude them. */
const MARKER_TYPE_PLAYER = 1;
const STEAM_AVATAR_CACHE_MS = 60 * 60 * 1000;
const DEATH_MARKERS_PER_PLAYER = 2;
/** Matches the grid cell size the map overlay draws in `map-geometry.ts`, so a
 *  death's grid square lines up with the square the player sees on the map. */
const GRID_CELL_SIZE = 150;

export type MapMarker = { id: string; type: number; x: number; y: number; name: string };
export type TeamMapMember = {
  id: string;
  name: string;
  x: number;
  y: number;
  isOnline: boolean;
  avatarUrl?: string;
};
type SteamAvatarEntry = { url: string; expiresAt: number };
export type DeathMarker = {
  id: string;
  playerId: string;
  name: string;
  x: number;
  y: number;
  deathTime: number;
};
/** A marker a player placed on the in-game F1 map (`AppTeamInfo.mapNotes` /
 *  `leaderMapNotes`), as opposed to a world marker like a vending machine or
 *  cargo ship (`AppMapMarkers`). Rust doesn't give these a stable id, so the
 *  caller synthesizes one from its fields. `source` distinguishes the connected
 *  player's own notes from the team leader's, so the UI can toggle each independently. */
export type TeamMapNote = {
  id: string;
  type: number;
  x: number;
  y: number;
  source: 'own' | 'leader';
};
type RustMonument = { token: string; x: number; y: number };
export type RustMap = {
  width: number;
  height: number;
  oceanMargin: number;
  mapSize: number;
  image: string;
  monuments: RustMonument[];
};

/** Rust grid column names: A, B, ... Z, AA, AB, ... */
function gridColumnLabel(index: number): string {
  let value = index + 1;
  let name = '';
  while (value) {
    name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

/** Grid square (e.g. "K14") a world position falls into, matching the labels the
 *  map overlay draws in `map-geometry.ts`'s `gridCellLabel`. */
function gridSquareLabel(mapSize: number, x: number, y: number): string | null {
  if (!Number.isFinite(mapSize) || mapSize <= 0 || !Number.isFinite(x) || !Number.isFinite(y))
    return null;
  const columns = Math.ceil(mapSize / GRID_CELL_SIZE);
  const column = Math.min(columns - 1, Math.max(0, Math.floor(x / GRID_CELL_SIZE)));
  const row = Math.min(columns - 1, Math.max(0, Math.floor((mapSize - y) / GRID_CELL_SIZE)));
  return `${gridColumnLabel(column)}${row + 1}`;
}

/** Map image/monuments, map markers, team member positions, and death history —
 *  everything driven by polling `getMap`/`getMapMarkers`/`getTeamInfo` on the active client. */
export class WorldStateService {
  private map: RustMap | null = null;
  private mapMarkers: MapMarker[] = [];
  private teamMapMembers: TeamMapMember[] = [];
  private mapNotes: TeamMapNote[] = [];
  private deathMarkers: DeathMarker[] = [];
  private markerSnapshots = new Map<string, string>();
  private teamDeaths = new Map<string, number>();
  private readonly steamAvatarCache = new Map<string, SteamAvatarEntry>();
  private readonly steamAvatarFetchInFlight = new Set<string>();
  private markerPolling: NodeJS.Timeout | null = null;
  private teamPolling: NodeJS.Timeout | null = null;
  private mapLoadTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly getClient: () => any,
    private readonly getStatus: () => ConnectionStatus,
    private readonly publishEvent: (event: RustEvent) => void,
    private readonly getSteamApiKey: () => string | undefined,
  ) {}

  getMap(): RustMap | null {
    return this.map;
  }

  getMapMarkers(): MapMarker[] {
    return this.mapMarkers;
  }

  getTeamMapMembers(): TeamMapMember[] {
    return this.teamMapMembers;
  }

  getMapNotes(): TeamMapNote[] {
    return this.mapNotes;
  }

  getDeathMarkers(): DeathMarker[] {
    return this.deathMarkers;
  }

  clearMapState(): void {
    this.stopMapLoading();
    this.map = null;
    this.mapMarkers = [];
    this.teamMapMembers = [];
    this.mapNotes = [];
  }

  clearDeathHistory(): void {
    this.deathMarkers = [];
  }

  loadMap(rustplus: any): void {
    this.stopMapLoading();
    try {
      rustplus.getInfo((infoMessage: any) => {
        if (this.getClient() !== rustplus) return true;
        if (isRateLimitError(infoMessage.response?.error)) {
          this.scheduleMapRetry(rustplus);
          return true;
        }
        const mapSize = Number(infoMessage.response?.info?.mapSize);
        if (infoMessage.response?.error || !Number.isFinite(mapSize) || mapSize <= 0) return true;
        rustplus.getMap((message: any) => {
          if (this.getClient() !== rustplus) return true;
          if (isRateLimitError(message.response?.error)) {
            this.scheduleMapRetry(rustplus);
            return true;
          }
          if (message.response?.error) return true;
          const map = message.response?.map;
          const width = Number(map?.width);
          const height = Number(map?.height);
          if (!map?.jpgImage || !Number.isFinite(width) || !Number.isFinite(height)) return true;
          const monuments: RustMonument[] = Array.isArray(map.monuments)
            ? map.monuments
                .map((monument: any) => ({
                  token: String(monument.token || ''),
                  x: Number(monument.x),
                  y: Number(monument.y),
                }))
                .filter(
                  (monument: RustMonument) =>
                    monument.token &&
                    Number.isFinite(monument.x) &&
                    Number.isFinite(monument.y) &&
                    // Underwater labs report one monument per room module (e.g.
                    // ".../underwater-lab-base/module_900x900_2way_moonpool.prefab")
                    // in addition to the lab's own entrance token
                    // (".../monument/underwater_lab/underwater_lab_a.prefab"),
                    // which duplicated the "Underwater Lab" label many times over.
                    !/underwater-lab-base/i.test(monument.token),
                )
            : [];
          this.map = {
            width,
            height,
            oceanMargin: Number.isFinite(Number(map.oceanMargin)) ? Number(map.oceanMargin) : 0,
            mapSize,
            image: `data:image/jpeg;base64,${Buffer.from(map.jpgImage).toString('base64')}`,
            monuments,
          };
          return true;
        });
        return true;
      });
    } catch (error) {
      logRust(`map request failed: ${errorSummary(error)}`);
    }
  }

  private scheduleMapRetry(rustplus: any): void {
    this.stopMapLoading();
    this.mapLoadTimer = setTimeout(() => {
      this.mapLoadTimer = null;
      if (this.getClient() === rustplus) this.loadMap(rustplus);
    }, MAP_LOAD_RETRY_MS);
  }

  stopMapLoading(): void {
    if (this.mapLoadTimer) clearTimeout(this.mapLoadTimer);
    this.mapLoadTimer = null;
  }

  startMarkerPolling(): void {
    this.stopMarkerPolling();
    this.markerSnapshots = new Map();
    const poll = () => {
      const client = this.getClient();
      if (!client || !this.getStatus().connected) return;
      client.getMapMarkers((message: any) => {
        const markers = message.response?.mapMarkers?.markers;
        if (!Array.isArray(markers)) return true;
        this.mapMarkers = markers
          .filter((marker: any) => Number(marker.type) !== MARKER_TYPE_PLAYER)
          .map((marker: any) => ({
            id: String(marker.id),
            type: Number(marker.type),
            x: Number(marker.x),
            y: Number(marker.y),
            name: String(marker.name || ''),
          }))
          .filter((marker: MapMarker) => Number.isFinite(marker.x) && Number.isFinite(marker.y));
        const next = new Map(
          markers.map((marker: any) => [
            String(marker.id),
            JSON.stringify({
              type: marker.type,
              name: marker.name,
              outOfStock: marker.outOfStock,
              sellOrders: marker.sellOrders,
            }),
          ]),
        );
        if (this.markerSnapshots.size)
          for (const marker of markers) {
            const id = String(marker.id);
            const previous = this.markerSnapshots.get(id);
            const changedVending = marker.type === 3 && previous && previous !== next.get(id);
            const newEvent = !previous && [3, 4, 5, 8].includes(marker.type);
            if (changedVending || newEvent)
              this.publishEvent({
                id: `${id}:${Date.now()}`,
                title:
                  (
                    {
                      3: 'Vending machine',
                      4: 'CH47',
                      5: 'Cargo Ship',
                      8: 'Patrol Helicopter',
                    } as Record<number, string>
                  )[marker.type] || 'Map event',
                body: changedVending
                  ? `${marker.name || 'Offers'} changed`
                  : 'New event detected on the map',
                type: marker.type,
                createdAt: new Date().toISOString(),
              });
          }
        this.markerSnapshots = next;
        return true;
      });
    };
    poll();
    this.markerPolling = setInterval(poll, 10000);
  }

  stopMarkerPolling(): void {
    if (this.markerPolling) clearInterval(this.markerPolling);
    this.markerPolling = null;
  }

  startTeamPolling(): void {
    this.stopTeamPolling();
    this.teamDeaths = new Map();
    const poll = () => {
      const client = this.getClient();
      if (!client || !this.getStatus().connected) return;
      client.getTeamInfo((message: any) => {
        const members = message.response?.teamInfo?.members;
        if (!Array.isArray(members)) return true;
        this.teamMapMembers = this.attachSteamAvatars(
          members
            .map((member: any) => ({
              id: String(member.steamId),
              name: String(member.name || 'Teammate'),
              x: Number(member.x),
              y: Number(member.y),
              isOnline: Boolean(member.isOnline),
            }))
            .filter(
              (member: TeamMapMember) => Number.isFinite(member.x) && Number.isFinite(member.y),
            ),
        );
        // A member's own placed note lands in `mapNotes`; the team leader's placed
        // notes (visible to the whole team, including the leader) land separately in
        // `leaderMapNotes` — kept tagged by `source` so the UI can toggle each on its own.
        const notes: Array<{ source: 'own' | 'leader'; type: unknown; x: unknown; y: unknown }> = [
          ...(message.response?.teamInfo?.mapNotes || []).map((note: any) => ({
            ...note,
            source: 'own' as const,
          })),
          ...(message.response?.teamInfo?.leaderMapNotes || []).map((note: any) => ({
            ...note,
            source: 'leader' as const,
          })),
        ];
        this.mapNotes = notes
          .map((note) => ({
            id: `${note.source}:${note.type}:${note.x}:${note.y}`,
            type: Number(note.type),
            x: Number(note.x),
            y: Number(note.y),
            source: note.source,
          }))
          .filter((note: TeamMapNote) => Number.isFinite(note.x) && Number.isFinite(note.y));
        const next = new Map(
          members.map((member: any) => [String(member.steamId), Number(member.deathTime || 0)]),
        );
        if (this.teamDeaths.size)
          for (const member of members) {
            const previous = this.teamDeaths.get(String(member.steamId)) || 0;
            const deathTime = Number(member.deathTime || 0);
            if (!member.isAlive && deathTime > previous) {
              const square = this.map
                ? gridSquareLabel(this.map.mapSize, Number(member.x), Number(member.y))
                : null;
              this.publishEvent({
                id: `${member.steamId}:${deathTime}`,
                title: 'Player death',
                body: square ? `${member.name} died in ${square}` : `${member.name} died`,
                type: 'player-death',
                createdAt: new Date().toISOString(),
              });
              this.recordDeathMarker({
                id: `${member.steamId}:${deathTime}`,
                playerId: String(member.steamId),
                name: String(member.name || 'Teammate'),
                x: Number(member.x),
                y: Number(member.y),
                deathTime,
              });
            }
          }
        this.teamDeaths = next;
        return true;
      });
    };
    poll();
    this.teamPolling = setInterval(poll, 10000);
  }

  stopTeamPolling(): void {
    if (this.teamPolling) clearInterval(this.teamPolling);
    this.teamPolling = null;
  }

  /** Rust+ only reports each player's current position, not death history, so this
   *  is captured ourselves at the moment a death is detected and kept per player
   *  (newest first, capped at `DEATH_MARKERS_PER_PLAYER`). */
  private recordDeathMarker(marker: DeathMarker): void {
    if (!Number.isFinite(marker.x) || !Number.isFinite(marker.y)) return;
    const ownHistory = this.deathMarkers
      .filter((entry) => entry.playerId === marker.playerId)
      .concat(marker)
      .sort((a, b) => b.deathTime - a.deathTime)
      .slice(0, DEATH_MARKERS_PER_PLAYER);
    this.deathMarkers = this.deathMarkers
      .filter((entry) => entry.playerId !== marker.playerId)
      .concat(ownHistory);
  }

  /**
   * Reads whatever avatar URLs are already cached and kicks off a background refresh
   * for any missing or stale ones; the refresh lands on the *next* poll cycle rather
   * than blocking this one.
   */
  private attachSteamAvatars(members: TeamMapMember[]): TeamMapMember[] {
    const apiKey = this.getSteamApiKey();
    if (!apiKey) return members;
    const now = Date.now();
    const stale = members
      .map((member) => member.id)
      .filter((id) => {
        const cached = this.steamAvatarCache.get(id);
        return (!cached || cached.expiresAt < now) && !this.steamAvatarFetchInFlight.has(id);
      });
    if (stale.length) this.refreshSteamAvatars(apiKey, stale);
    return members.map((member) => {
      const cached = this.steamAvatarCache.get(member.id);
      return cached ? { ...member, avatarUrl: cached.url } : member;
    });
  }

  private refreshSteamAvatars(apiKey: string, steamIds: string[]): void {
    steamIds.forEach((id) => this.steamAvatarFetchInFlight.add(id));
    const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${encodeURIComponent(apiKey)}&steamids=${steamIds.join(',')}`;
    fetch(url)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: any) => {
        const players = data?.response?.players;
        if (!Array.isArray(players)) return;
        const expiresAt = Date.now() + STEAM_AVATAR_CACHE_MS;
        for (const player of players) {
          const avatarUrl = String(player.avatarfull || player.avatarmedium || player.avatar || '');
          if (avatarUrl)
            this.steamAvatarCache.set(String(player.steamid), { url: avatarUrl, expiresAt });
        }
      })
      .catch((error) => logRust(`steam avatar fetch failed: ${errorSummary(error)}`))
      .finally(() => steamIds.forEach((id) => this.steamAvatarFetchInFlight.delete(id)));
  }
}
