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

export type MapMetrics = {
  playableWidth: number;
  playableHeight: number;
  columns: number;
  aspectRatio: string;
  imageStyle: { width: string; height: string; left: string; top: string };
};

/**
 * The map image includes an ocean border that is not part of the playable grid, so
 * the image is scaled up and offset until only the playable area fills the canvas.
 */
export function mapMetrics(map: RustMap): MapMetrics {
  const margin = Number(map.oceanMargin || 0);
  const playableWidth = map.width - margin * 2;
  const playableHeight = map.height - margin * 2;
  return {
    playableWidth,
    playableHeight,
    columns: Math.ceil(map.mapSize / GRID_CELL_SIZE),
    aspectRatio: `${playableWidth} / ${playableHeight}`,
    imageStyle: {
      width: `${(map.width / playableWidth) * 100}%`,
      height: `${(map.height / playableHeight) * 100}%`,
      left: `${(-margin / playableWidth) * 100}%`,
      top: `${(-margin / playableHeight) * 100}%`,
    },
  };
}

/** Rust map coordinates grow upwards; CSS `top` grows downwards. */
export function markerPosition(
  map: RustMap,
  point: Pick<MapPoint, 'x' | 'y'>,
): { left: string; top: string } {
  return {
    left: `${(Number(point.x) / map.mapSize) * 100}%`,
    top: `${((map.mapSize - Number(point.y)) / map.mapSize) * 100}%`,
  };
}

const EVENT_MARKER_TYPES = new Set([4, 5, 8]);

export function markerKind(type: number | undefined): 'event' | 'server' {
  return EVENT_MARKER_TYPES.has(type || 0) ? 'event' : 'server';
}
