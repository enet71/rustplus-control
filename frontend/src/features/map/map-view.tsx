import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { MapPin, Moon, Skull, TrainFrontTunnel, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DashboardState } from '../../shared/api-types';
import {
  centeredMapTransform,
  clampMapTransform,
  fitMapSize,
  gridCellLabel,
  gridCellRect,
  isTunnelMonument,
  mapMetrics,
  markerKind,
  markerPosition,
  monumentLabel,
  zoomMapTransform,
  type MapTransform,
  type Size,
} from './map-geometry';
import { isMapNotReady, useMap } from './use-map';

type MapViewProps = {
  serverId: string;
  teamMapMembers: DashboardState['teamMapMembers'];
  mapMarkers: DashboardState['mapMarkers'];
  deathMarkers: DashboardState['deathMarkers'];
};

function MapPlaceholder({ message }: { message: string }) {
  return (
    <section>
      <p className="text-sm text-muted-foreground">{message}</p>
    </section>
  );
}

export function MapView({ serverId, teamMapMembers, mapMarkers, deathMarkers }: MapViewProps) {
  const { data: map, error } = useMap(serverId);
  // A plain ref set in a mount-only effect would miss the container: `map` is still
  // undefined on the very first render (react-query never has data synchronously),
  // so that render returns the placeholder with no `.rust-map` node to attach to,
  // and the `[]`-deps effect never runs again once the real node shows up. Tracking
  // the node in state instead re-runs dependent effects when it actually appears.
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const [containerSize, setContainerSize] = useState<Size>({ width: 0, height: 0 });
  const [transform, setTransform] = useState<MapTransform>({ x: 0, y: 0, scale: 1 });
  const [isPanning, setIsPanning] = useState(false);
  const [resetKey, setResetKey] = useState('');

  const earlyMetrics = map ? mapMetrics(map) : null;
  const aspect = earlyMetrics ? earlyMetrics.playableWidth / earlyMetrics.playableHeight : 1;
  // Memoized so its identity only changes when the inputs genuinely do — the wheel
  // effect below depends on it, and an unstable reference would re-attach the
  // listener on every render.
  const fit = useMemo(() => fitMapSize(containerSize, aspect), [containerSize, aspect]);

  // Recenter during render (not in an effect) whenever the map image or the fitted
  // size changes, following React's "adjusting state when props/derived values
  // change" pattern — this re-renders once with the new transform instead of
  // committing the stale one first and fixing it up a tick later in an effect.
  const nextResetKey = `${map?.image ?? ''}:${fit.width}:${fit.height}`;
  if (resetKey !== nextResetKey) {
    setResetKey(nextResetKey);
    setTransform(centeredMapTransform(fit, containerSize));
  }

  useEffect(() => {
    if (!containerEl) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry)
        setContainerSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(containerEl);
    return () => observer.disconnect();
  }, [containerEl]);

  useEffect(() => {
    if (!containerEl) return;
    // A JSX `onWheel` handler is attached passively by React, so `preventDefault()`
    // silently fails to stop the page from scrolling; a native listener is required.
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = containerEl.getBoundingClientRect();
      const cursor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const factor = Math.exp(-event.deltaY * 0.0015);
      setTransform((current) =>
        clampMapTransform(zoomMapTransform(current, cursor, factor), fit, containerSize),
      );
    };
    containerEl.addEventListener('wheel', onWheel, { passive: false });
    return () => containerEl.removeEventListener('wheel', onWheel);
  }, [containerEl, fit, containerSize]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    dragRef.current = { x: event.clientX, y: event.clientY };
    setIsPanning(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const start = dragRef.current;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    dragRef.current = { x: event.clientX, y: event.clientY };
    setTransform((current) =>
      clampMapTransform({ ...current, x: current.x + dx, y: current.y + dy }, fit, containerSize),
    );
  };

  const stopPanning = (event: ReactPointerEvent<HTMLDivElement>): void => {
    dragRef.current = null;
    setIsPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };

  if (!map) {
    if (error && !isMapNotReady(error))
      return <MapPlaceholder message="Map could not be loaded." />;
    return <MapPlaceholder message="Map is not available yet." />;
  }

  const metrics = mapMetrics(map);
  const cells = metrics.columns * metrics.columns;

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div
        ref={setContainerEl}
        className={cn('rust-map', isPanning && 'is-panning')}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopPanning}
        onPointerCancel={stopPanning}
      >
        <div
          className="map-canvas"
          style={{
            width: fit.width,
            height: fit.height,
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          }}
        >
          <img src={map.image} alt="Rust server map" style={metrics.imageStyle} />
          <div className="map-marker-layer" style={{ '--zoom': transform.scale } as CSSProperties}>
            {teamMapMembers.map((member) => (
              <span
                className="map-marker-anchor"
                key={member.id}
                style={markerPosition(map, member)}
                title={member.isOnline ? member.name : `${member.name} (sleeping)`}
              >
                <span className={cn('map-marker team', !member.isOnline && 'is-sleeping')}>
                  {member.avatarUrl ? (
                    <img src={member.avatarUrl} alt="" />
                  ) : member.isOnline ? (
                    <User className="size-4" />
                  ) : (
                    <Moon className="size-4" />
                  )}
                </span>
                {member.isOnline && <span className="map-marker-label">{member.name}</span>}
              </span>
            ))}
            {mapMarkers.map((marker) => (
              <span
                className="map-marker-anchor"
                key={marker.id}
                style={markerPosition(map, marker)}
                title={marker.name || 'Map marker'}
              >
                <span className={`map-marker ${markerKind(marker.type)}`} />
              </span>
            ))}
            {deathMarkers.map((death) => (
              <span
                className="map-marker-anchor"
                key={death.id}
                style={markerPosition(map, death)}
                title={`${death.name} died here`}
              >
                <span className="map-marker death">
                  <Skull className="size-3" />
                </span>
              </span>
            ))}
            {(map.monuments || []).map((monument, index) => (
              <span
                className="map-marker-anchor monument"
                key={`${monument.token}:${index}`}
                style={markerPosition(map, monument)}
              >
                <span className="map-marker monument">
                  {isTunnelMonument(monument.token) ? (
                    <TrainFrontTunnel className="size-3" />
                  ) : (
                    <MapPin className="size-3" />
                  )}
                </span>
                <span className="map-marker-label monument">{monumentLabel(monument.token)}</span>
              </span>
            ))}
          </div>
        </div>
        {/* Rendered outside the zoomed canvas so line width and label size stay
            constant instead of growing with the zoom level; each cell's own
            position/size is computed in container pixels to still track pan/zoom. */}
        <div className="map-grid-overlay">
          {Array.from({ length: cells }, (_, index) => {
            const rect = gridCellRect(index, metrics.columns, fit, transform);
            return (
              <span
                className="map-grid-cell"
                key={index}
                style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
              >
                {gridCellLabel(index, metrics.columns)}
              </span>
            );
          })}
        </div>
      </div>
      <div className="map-legend">
        <span>
          <i className="map-dot map-dot-team" />
          Team
        </span>
        <span>
          <i className="map-dot map-dot-sleeping" />
          Sleeping
        </span>
        <span>
          <i className="map-dot map-dot-marker" />
          Server markers
        </span>
        <span>
          <i className="map-dot map-dot-death" />
          Recent deaths
        </span>
        <span>
          <i className="map-dot map-dot-monument" />
          Monuments
        </span>
      </div>
    </section>
  );
}
