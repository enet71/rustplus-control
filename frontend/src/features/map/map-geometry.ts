import type { MapPoint, RustMap } from '../../shared/api-types';

const GRID_CELL_SIZE = 150;

/** Rust grid column names: A, B, ... Z, AA, AB, ... */
export function gridColumnLabel(index: number): string {
  let value = index + 1;
  let name = '';
  while (value) {
    name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

export function gridCellLabel(index: number, columns: number): string {
  return `${gridColumnLabel(index % columns)}${Math.floor(index / columns) + 1}`;
}

/**
 * `AppMap.Monument.token` is an internal Rust asset name (e.g.
 * "trainyard_display_name"), not a display string — Rust+ has no localization API,
 * so this is a best-effort translation. Tokens not listed here fall back to
 * `prettifyMonumentToken`; report any that come out wrong so this list can grow.
 */
const MONUMENT_LABELS: Record<string, string> = {
  airfield_display_name: 'Airfield',
  arctic_research_base_display_name: 'Arctic Research Base',
  bandit_camp: 'Bandit Camp',
  dome_monument_name: 'The Dome',
  ferryterminal_display_name: 'Ferry Terminal',
  fishing_village_display_name: 'Fishing Village',
  gas_station_1: "Oxum's Gas Station",
  harbor_1: 'Harbor',
  harbor_2: 'Harbor',
  junkyard_display_name: 'Junkyard',
  launch_site_display_name: 'Launch Site',
  lighthouse_display_name: 'Lighthouse',
  military_tunnel_1: 'Military Tunnels',
  mining_outpost_display_name: 'Mining Outpost',
  nuclear_missile_silo_monument_name: 'Missile Silo',
  oilrig_1: 'Small Oil Rig',
  large_oil_rig: 'Large Oil Rig',
  outpost: 'Outpost',
  compound: 'Outpost',
  power_plant_display_name: 'Power Plant',
  satellite_dish_display_name: 'Satellite Dish',
  sewer_display_name: 'Sewer Branch',
  stables_a: 'Ranch',
  stables_b: 'Large Barn',
  supermarket_display_name: 'Supermarket',
  swamp_c_display_name: 'Swamp',
  trainyard_display_name: 'Train Yard',
  warehouse_display_name: 'Warehouse',
  water_treatment_plant_display_name: 'Water Treatment Plant',
  water_well_display_name: 'Water Well',
};

/** "military_tunnel_1" -> "Military Tunnel 1" for tokens with no curated label. */
export function prettifyMonumentToken(token: string): string {
  const cleaned = token
    .replace(/_display_name$|_monument_name$/i, '')
    .replace(/[_-]+/g, ' ')
    .trim();
  return cleaned.replace(/\w\S*/g, (word) => word[0].toUpperCase() + word.slice(1));
}

export function monumentLabel(token: string): string {
  if (MONUMENT_LABELS[token]) return MONUMENT_LABELS[token];
  // Underwater lab pieces report their raw prefab path instead of a short
  // display-name token (e.g. ".../underwater_lab/underwater_lab_a.prefab" or
  // ".../underwater-lab-base/module_900x900_2way_moonpool.prefab"), and every
  // variant/module spawned still names the family somewhere in that path —
  // so match anywhere in the string instead of requiring an exact token.
  if (/underwater[-_]lab/i.test(token)) return 'Underwater Lab';
  return prettifyMonumentToken(token);
}

/** The underground train network's surface entrance — gets an icon instead of
 *  a text label. The Military Tunnels monument is a separate, ordinary
 *  monument and keeps its text label (see `MONUMENT_LABELS`). */
export function isTunnelEntranceMonument(token: string): boolean {
  return /train_tunnel_display_name/i.test(token) || isTunnelLinkMonument(token);
}

/** The tunnel-mouth segment linking two train tunnel entrances, as opposed to
 *  a plain surface entrance — the two get different icons. */
export function isTunnelLinkMonument(token: string): boolean {
  return /train_tunnel_link_display_name/i.test(token);
}

export type MapMetrics = {
  columns: number;
};

export function mapMetrics(map: RustMap): MapMetrics {
  return { columns: Math.ceil(map.mapSize / GRID_CELL_SIZE) };
}

/**
 * The map image includes an ocean border around the playable `mapSize` square (this
 * is where ocean-only monuments like oil rigs sit) — expressed as a fraction of the
 * full image so the grid overlay can inset itself to the playable square within it.
 */
export function playableInset(map: RustMap): {
  left: number;
  top: number;
  width: number;
  height: number;
} {
  const marginX = Number(map.oceanMargin || 0) / map.width;
  const marginY = Number(map.oceanMargin || 0) / map.height;
  return { left: marginX, top: marginY, width: 1 - marginX * 2, height: 1 - marginY * 2 };
}

/** Rust map coordinates grow upwards; CSS `top` grows downwards. Points outside
 *  the playable `[0, mapSize]` square (oil rigs and other ocean monuments) still
 *  land correctly because the conversion is anchored to the full image, not just
 *  the playable area. */
export function markerPosition(
  map: RustMap,
  point: Pick<MapPoint, 'x' | 'y'>,
): { left: string; top: string } {
  const margin = Number(map.oceanMargin || 0);
  const playableWidth = map.width - margin * 2;
  const playableHeight = map.height - margin * 2;
  const pixelX = margin + (Number(point.x) / map.mapSize) * playableWidth;
  const pixelY = margin + ((map.mapSize - Number(point.y)) / map.mapSize) * playableHeight;
  return {
    left: `${(pixelX / map.width) * 100}%`,
    top: `${(pixelY / map.height) * 100}%`,
  };
}

const EVENT_MARKER_TYPES = new Set([4, 5, 8]);

export function markerKind(type: number | undefined): 'event' | 'server' {
  return EVENT_MARKER_TYPES.has(type || 0) ? 'event' : 'server';
}

export const MIN_MAP_ZOOM = 1;
export const MAX_MAP_ZOOM = 6;
export const INITIAL_MAP_ZOOM = (MIN_MAP_ZOOM + MAX_MAP_ZOOM) / 2;

export type MapTransform = { x: number; y: number; scale: number };
export type Size = { width: number; height: number };

/** The largest box preserving `aspect` (width / height) that fits inside `container`. */
export function fitMapSize(container: Size, aspect: number): Size {
  if (!container.width || !container.height || !Number.isFinite(aspect) || aspect <= 0)
    return { width: 0, height: 0 };
  let width = container.width;
  let height = width / aspect;
  if (height > container.height) {
    height = container.height;
    width = height * aspect;
  }
  return { width, height };
}

/**
 * Keeps content centered on an axis where it is smaller than the container, and
 * otherwise stops it from panning past its edges.
 */
export function clampPanAxis(position: number, contentSize: number, containerSize: number): number {
  if (contentSize <= containerSize) return (containerSize - contentSize) / 2;
  return Math.min(0, Math.max(containerSize - contentSize, position));
}

export function clampMapTransform(
  transform: MapTransform,
  fitSize: Size,
  container: Size,
): MapTransform {
  return {
    scale: transform.scale,
    x: clampPanAxis(transform.x, fitSize.width * transform.scale, container.width),
    y: clampPanAxis(transform.y, fitSize.height * transform.scale, container.height),
  };
}

export function centeredMapTransform(
  fitSize: Size,
  container: Size,
  scale: number = INITIAL_MAP_ZOOM,
): MapTransform {
  return {
    x: (container.width - fitSize.width * scale) / 2,
    y: (container.height - fitSize.height * scale) / 2,
    scale,
  };
}

/** Zooms the transform so the point under the cursor stays fixed on screen. */
export function zoomMapTransform(
  current: MapTransform,
  cursor: { x: number; y: number },
  factor: number,
): MapTransform {
  const scale = Math.min(MAX_MAP_ZOOM, Math.max(MIN_MAP_ZOOM, current.scale * factor));
  const localX = (cursor.x - current.x) / current.scale;
  const localY = (cursor.y - current.y) / current.scale;
  return { scale, x: cursor.x - localX * scale, y: cursor.y - localY * scale };
}

/** Inverse of `markerPosition`: given a click's position in container pixels
 *  (relative to `.rust-map`'s top-left corner) and the canvas's current pan/zoom,
 *  returns the Rust world coordinates under that point. */
export function worldPositionFromScreen(
  map: RustMap,
  transform: MapTransform,
  fit: Size,
  screen: { x: number; y: number },
): { x: number; y: number } {
  if (!fit.width || !fit.height) return { x: 0, y: 0 };
  const layerX = (screen.x - transform.x) / transform.scale;
  const layerY = (screen.y - transform.y) / transform.scale;
  const pixelX = (layerX / fit.width) * map.width;
  const pixelY = (layerY / fit.height) * map.height;
  const margin = Number(map.oceanMargin || 0);
  const playableWidth = map.width - margin * 2;
  const playableHeight = map.height - margin * 2;
  return {
    x: ((pixelX - margin) / playableWidth) * map.mapSize,
    y: map.mapSize - ((pixelY - margin) / playableHeight) * map.mapSize,
  };
}

export type PixelRect = { left: number; top: number; width: number; height: number };

/**
 * A grid cell's on-screen box in container pixels. Rendered outside the zoomed
 * canvas so its border width and label size stay constant instead of growing with
 * `transform.scale` — only the box's position and size (i.e. where the lines fall)
 * track the zoom. `inset` (see `playableInset`) confines the grid to the playable
 * square, since the canvas now also shows the ocean margin around it.
 */
export function gridCellRect(
  index: number,
  columns: number,
  fitSize: Size,
  transform: MapTransform,
  inset: { left: number; top: number; width: number; height: number },
): PixelRect {
  const canvasWidth = fitSize.width * transform.scale;
  const canvasHeight = fitSize.height * transform.scale;
  const width = (canvasWidth * inset.width) / columns;
  const height = (canvasHeight * inset.height) / columns;
  return {
    left: transform.x + canvasWidth * inset.left + (index % columns) * width,
    top: transform.y + canvasHeight * inset.top + Math.floor(index / columns) * height,
    width,
    height,
  };
}
