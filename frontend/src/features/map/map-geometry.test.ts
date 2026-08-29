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
  isTunnelEntranceMonument,
  isTunnelLinkMonument,
  mapMetrics,
  markerKind,
  markerPosition,
  monumentLabel,
  playableInset,
  prettifyMonumentToken,
  worldPositionFromScreen,
  zoomMapTransform,
} from './map-geometry';
import type { RustMap } from '../../shared/api-types';

const map: RustMap = {
  width: 2000,
  height: 2000,
  oceanMargin: 250,
  mapSize: 3000,
  image: 'map.png',
  monuments: [],
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
  const fullInset = { left: 0, top: 0, width: 1, height: 1 };

  it('places cells in container pixels, tracking pan and zoom', () => {
    const fitSize = { width: 400, height: 400 };
    expect(gridCellRect(0, 4, fitSize, { x: 0, y: 0, scale: 1 }, fullInset)).toEqual({
      left: 0,
      top: 0,
      width: 100,
      height: 100,
    });
    expect(gridCellRect(5, 4, fitSize, { x: 0, y: 0, scale: 1 }, fullInset)).toEqual({
      left: 100,
      top: 100,
      width: 100,
      height: 100,
    });
  });

  it('scales cell size and offsets position with the current zoom and pan', () => {
    const fitSize = { width: 400, height: 400 };
    expect(gridCellRect(0, 4, fitSize, { x: 10, y: 20, scale: 2 }, fullInset)).toEqual({
      left: 10,
      top: 20,
      width: 200,
      height: 200,
    });
  });

  it('confines the grid to the playable square when the canvas also shows the ocean margin', () => {
    const fitSize = { width: 400, height: 400 };
    const inset = { left: 0.1, top: 0.1, width: 0.8, height: 0.8 };
    expect(gridCellRect(0, 4, fitSize, { x: 0, y: 0, scale: 1 }, inset)).toEqual({
      left: 40,
      top: 40,
      width: 80,
      height: 80,
    });
  });
});

describe('mapMetrics', () => {
  it('derives one grid column per 150 map units', () => {
    expect(mapMetrics({ ...map, mapSize: 3000 }).columns).toBe(20);
    expect(mapMetrics({ ...map, mapSize: 3050 }).columns).toBe(21);
  });
});

describe('playableInset', () => {
  it('expresses the ocean margin as a fraction of the full image', () => {
    expect(playableInset(map)).toEqual({ left: 0.125, top: 0.125, width: 0.75, height: 0.75 });
  });

  it('covers the whole image when there is no ocean margin', () => {
    expect(playableInset({ ...map, oceanMargin: 0 })).toEqual({
      left: 0,
      top: 0,
      width: 1,
      height: 1,
    });
  });
});

describe('markerPosition', () => {
  it('flips the vertical axis because Rust coordinates grow upwards, anchored to the full image', () => {
    expect(markerPosition(map, { x: 0, y: 3000 })).toEqual({ left: '12.5%', top: '12.5%' });
    expect(markerPosition(map, { x: 3000, y: 0 })).toEqual({ left: '87.5%', top: '87.5%' });
    expect(markerPosition(map, { x: 1500, y: 1500 })).toEqual({ left: '50%', top: '50%' });
  });

  it('places ocean monuments (e.g. oil rigs) outside the playable square within the ocean margin', () => {
    expect(markerPosition(map, { x: -500, y: 1500 })).toEqual({ left: '0%', top: '50%' });
    expect(markerPosition(map, { x: 3500, y: 1500 })).toEqual({ left: '100%', top: '50%' });
  });
});

describe('worldPositionFromScreen', () => {
  const fit = { width: map.width, height: map.height };
  const identity = { x: 0, y: 0, scale: 1 };

  it('inverts markerPosition at the map center', () => {
    expect(worldPositionFromScreen(map, identity, fit, { x: 1000, y: 1000 })).toEqual({
      x: 1500,
      y: 1500,
    });
  });

  it('accounts for the canvas pan and zoom', () => {
    const transform = { x: 10, y: 20, scale: 2 };
    expect(worldPositionFromScreen(map, transform, fit, { x: 2010, y: 2020 })).toEqual({
      x: 1500,
      y: 1500,
    });
  });

  it('returns a zero sentinel before the map has been fitted (fit size still 0)', () => {
    expect(
      worldPositionFromScreen(map, identity, { width: 0, height: 0 }, { x: 10, y: 10 }),
    ).toEqual({ x: 0, y: 0 });
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

describe('monumentLabel', () => {
  it('translates known tokens to a display name', () => {
    expect(monumentLabel('trainyard_display_name')).toBe('Train Yard');
    expect(monumentLabel('launch_site_display_name')).toBe('Launch Site');
  });

  it('falls back to a prettified token for unknown ones', () => {
    expect(monumentLabel('some_new_monument_display_name')).toBe('Some New Monument');
  });

  it('labels every underwater lab variant, including raw prefab-path tokens', () => {
    expect(
      monumentLabel(
        'assets/bundled/prefabs/autospawn/monument/underwater_lab/underwater_lab_a.prefab',
      ),
    ).toBe('Underwater Lab');
    expect(
      monumentLabel(
        'assets/bundled/prefabs/autospawn/underwater-lab-base/module_900x900_2way_moonpool.prefab',
      ),
    ).toBe('Underwater Lab');
  });
});

describe('prettifyMonumentToken', () => {
  it('strips the display/monument name suffix and title-cases the rest', () => {
    expect(prettifyMonumentToken('sewer_display_name')).toBe('Sewer');
    expect(prettifyMonumentToken('dome_monument_name')).toBe('Dome');
    expect(prettifyMonumentToken('military_tunnel_1')).toBe('Military Tunnel 1');
  });
});

describe('isTunnelEntranceMonument', () => {
  it('flags a train tunnel entrance or link, not the unrelated Military Tunnels monument', () => {
    expect(isTunnelEntranceMonument('train_tunnel_display_name')).toBe(true);
    expect(isTunnelEntranceMonument('train_tunnel_link_display_name')).toBe(true);
    expect(isTunnelEntranceMonument('military_tunnel_1')).toBe(false);
  });
});

describe('isTunnelLinkMonument', () => {
  it('flags only the link variant, not the plain entrance', () => {
    expect(isTunnelLinkMonument('train_tunnel_link_display_name')).toBe(true);
    expect(isTunnelLinkMonument('train_tunnel_display_name')).toBe(false);
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
