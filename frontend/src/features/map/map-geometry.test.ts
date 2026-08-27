import { describe, expect, it } from 'vitest';
import {
  gridCellLabel,
  gridColumnLabel,
  mapMetrics,
  markerKind,
  markerPosition,
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
