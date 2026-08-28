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

export type PixelRect = { left: number; top: number; width: number; height: number };

/**
 * A grid cell's on-screen box in container pixels. Rendered outside the zoomed
 * canvas so its border width and label size stay constant instead of growing with
 * `transform.scale` — only the box's position and size (i.e. where the lines fall)
 * track the zoom.
 */
export function gridCellRect(
  index: number,
  columns: number,
  fitSize: Size,
  transform: MapTransform,
): PixelRect {
  const width = (fitSize.width * transform.scale) / columns;
  const height = (fitSize.height * transform.scale) / columns;
  return {
    left: transform.x + (index % columns) * width,
    top: transform.y + Math.floor(index / columns) * height,
    width,
    height,
  };
}
