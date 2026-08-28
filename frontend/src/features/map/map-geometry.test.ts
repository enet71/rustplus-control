import { describe, expect, it } from 'vitest';
import {
  INITIAL_MAP_ZOOM,
  centeredMapTransform,
  clampMapTransform,
  clampPanAxis,
  fitMapSize,
  gridCellLabel,
  gridCellRect,
  gridColumnLabel,
  mapMetrics,
  markerKind,
  markerPosition,
  zoomMapTransform,
} from './map-geometry';
import type { RustMap } from '../../shared/api-types';

const map: RustMap = {
  width: 2000,
  height: 2000,
  oceanMargin: 250,
  mapSize: 3000,
  image: 'map.png',
};

describe('gridColumnLabel', () => {
  it('continues past Z with two-letter names', () => {
    expect(gridColumnLabel(0)).toBe('A');
    expect(gridColumnLabel(25)).toBe('Z');
    expect(gridColumnLabel(26)).toBe('AA');
    expect(gridColumnLabel(27)).toBe('AB');
    expect(gridColumnLabel(51)).toBe('AZ');
    expect(gridColumnLabel(52)).toBe('BA');
  });
});

describe('gridCellLabel', () => {
  it('numbers rows downwards and letters columns rightwards', () => {
    expect(gridCellLabel(0, 4)).toBe('A1');
    expect(gridCellLabel(3, 4)).toBe('D1');
    expect(gridCellLabel(4, 4)).toBe('A2');
  });
});

describe('gridCellRect', () => {
  it('places cells in container pixels, tracking pan and zoom', () => {
    const fitSize = { width: 400, height: 400 };
    expect(gridCellRect(0, 4, fitSize, { x: 0, y: 0, scale: 1 })).toEqual({
      left: 0,
      top: 0,
      width: 100,
      height: 100,
    });
    expect(gridCellRect(5, 4, fitSize, { x: 0, y: 0, scale: 1 })).toEqual({
      left: 100,
      top: 100,
      width: 100,
      height: 100,
    });
  });

  it('scales cell size and offsets position with the current zoom and pan', () => {
    const fitSize = { width: 400, height: 400 };
    expect(gridCellRect(0, 4, fitSize, { x: 10, y: 20, scale: 2 })).toEqual({
      left: 10,
      top: 20,
      width: 200,
      height: 200,
    });
  });
});

describe('mapMetrics', () => {
  it('scales and offsets the image so only the playable area fills the canvas', () => {
    const metrics = mapMetrics(map);

    expect(metrics.playableWidth).toBe(1500);
    expect(metrics.playableHeight).toBe(1500);
    expect(metrics.aspectRatio).toBe('1500 / 1500');
    expect(metrics.imageStyle).toEqual({
      width: `${(2000 / 1500) * 100}%`,
      height: `${(2000 / 1500) * 100}%`,
      left: `${(-250 / 1500) * 100}%`,
      top: `${(-250 / 1500) * 100}%`,
    });
  });

  it('covers the whole map when there is no ocean margin', () => {
    const metrics = mapMetrics({ ...map, oceanMargin: 0 });

    expect(metrics.playableWidth).toBe(2000);
    expect(metrics.imageStyle).toEqual({ width: '100%', height: '100%', left: '0%', top: '0%' });
  });

  it('derives one grid column per 150 map units', () => {
    expect(mapMetrics({ ...map, mapSize: 3000 }).columns).toBe(20);
    expect(mapMetrics({ ...map, mapSize: 3050 }).columns).toBe(21);
  });
});

describe('markerPosition', () => {
  it('flips the vertical axis because Rust coordinates grow upwards', () => {
    expect(markerPosition(map, { x: 0, y: 3000 })).toEqual({ left: '0%', top: '0%' });
    expect(markerPosition(map, { x: 3000, y: 0 })).toEqual({ left: '100%', top: '100%' });
    expect(markerPosition(map, { x: 1500, y: 1500 })).toEqual({ left: '50%', top: '50%' });
  });
});

describe('markerKind', () => {
  it('treats known event marker types as events and the rest as server markers', () => {
    expect(markerKind(4)).toBe('event');
    expect(markerKind(5)).toBe('event');
    expect(markerKind(8)).toBe('event');
    expect(markerKind(1)).toBe('server');
    expect(markerKind(undefined)).toBe('server');
  });
});

describe('fitMapSize', () => {
  it('shrinks the width when the container is taller than the map is wide', () => {
    expect(fitMapSize({ width: 1000, height: 1000 }, 2)).toEqual({ width: 1000, height: 500 });
  });

  it('shrinks the height when the container is wider than the map is tall', () => {
    expect(fitMapSize({ width: 1000, height: 200 }, 1)).toEqual({ width: 200, height: 200 });
  });
});

describe('clampPanAxis', () => {
  it('centers content that is smaller than the container', () => {
    expect(clampPanAxis(999, 400, 1000)).toBe(300);
  });

  it('stops content larger than the container from panning past its edges', () => {
    expect(clampPanAxis(50, 1500, 1000)).toBe(0);
    expect(clampPanAxis(-900, 1500, 1000)).toBe(-500);
    expect(clampPanAxis(-9999, 1500, 1000)).toBe(-500);
  });
});

describe('centeredMapTransform', () => {
  it('defaults to the halfway zoom level, centered', () => {
    expect(INITIAL_MAP_ZOOM).toBe(3.5);
    expect(centeredMapTransform({ width: 400, height: 400 }, { width: 1000, height: 800 })).toEqual(
      { x: -200, y: -300, scale: 3.5 },
    );
  });

  it('centers the fitted content at an explicit scale', () => {
    expect(
      centeredMapTransform({ width: 400, height: 400 }, { width: 1000, height: 800 }, 1),
    ).toEqual({ x: 300, y: 200, scale: 1 });
  });
});

describe('clampMapTransform', () => {
  it('re-centers an axis once zooming out makes it smaller than the container', () => {
    const next = clampMapTransform(
      { x: -400, y: -400, scale: 1 },
      { width: 500, height: 500 },
      { width: 1000, height: 1000 },
    );

    expect(next).toEqual({ x: 250, y: 250, scale: 1 });
  });
});

describe('zoomMapTransform', () => {
  it('keeps the point under the cursor fixed on screen while zooming in', () => {
    const next = zoomMapTransform({ x: 0, y: 0, scale: 1 }, { x: 100, y: 100 }, 2);

    expect(next.scale).toBe(2);
    expect(next.x).toBe(-100);
    expect(next.y).toBe(-100);
  });

  it('never zooms past the configured min/max', () => {
    expect(zoomMapTransform({ x: 0, y: 0, scale: 1 }, { x: 0, y: 0 }, 0.1).scale).toBe(1);
    expect(zoomMapTransform({ x: 0, y: 0, scale: 6 }, { x: 0, y: 0 }, 10).scale).toBe(6);
  });
});
