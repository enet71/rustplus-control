import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { MapPin, MapPinPlus, Moon, Skull, Train, TrainFrontTunnel, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { DashboardState } from '../../shared/api-types';
import { CustomMarkerDialog } from './custom-marker-dialog';
import { CustomMarkerInfoDialog } from './custom-marker-info-dialog';
import { CustomMarkersPanel } from './custom-markers-panel';
import type { CustomMarkerMutations } from './use-custom-markers';
import {
  readHiddenNoteSources,
  writeHiddenNoteSources,
  type NoteSource,
} from './hidden-note-sources';
import { readHiddenPlayers, writeHiddenPlayers } from './hidden-players';
import { readTeamPanelOpen, writeTeamPanelOpen } from './team-panel-open';
import { TeamVisibilityPanel } from './team-visibility-panel';
import {
  centeredMapTransform,
  clampMapTransform,
  fitMapSize,
  gridCellLabel,
  gridCellRect,
  isTunnelEntranceMonument,
  isTunnelLinkMonument,
  mapMetrics,
  markerKind,
  markerPosition,
  monumentLabel,
  playableInset,
  worldPositionFromScreen,
  zoomMapTransform,
  type MapTransform,
  type Size,
} from './map-geometry';
import { isMapNotReady, useMap } from './use-map';

const CLICK_DRAG_TOLERANCE_PX = 5;

type CustomMarker = DashboardState['config']['customMarkers'][number];

type MapViewProps = {
  serverId: string;
  teamMapMembers: DashboardState['teamMapMembers'];
  mapMarkers: DashboardState['mapMarkers'];
  mapNotes: DashboardState['mapNotes'];
  deathMarkers: DashboardState['deathMarkers'];
  customMarkers: CustomMarker[];
  customMarkerMutations: CustomMarkerMutations;
};

function MapPlaceholder({ message }: { message: string }) {
  return (
    <section>
      <p className="text-sm text-muted-foreground">{message}</p>
    </section>
  );
}

export function MapView({
  serverId,
  teamMapMembers,
  mapMarkers,
  mapNotes,
  deathMarkers,
  customMarkers,
  customMarkerMutations,
}: MapViewProps) {
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
  const [hiddenPlayers, setHiddenPlayers] = useState<Set<string>>(() =>
    readHiddenPlayers(serverId),
  );
  const [hiddenNoteSources, setHiddenNoteSources] = useState<Set<NoteSource>>(() =>
    readHiddenNoteSources(serverId),
  );
  const [teamPanelOpen, setTeamPanelOpen] = useState(() => readTeamPanelOpen(serverId));
  const [customMarkersPanelOpen, setCustomMarkersPanelOpen] = useState(false);
  const [placingMarker, setPlacingMarker] = useState(false);
  const [pendingMarkerPosition, setPendingMarkerPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [viewingMarker, setViewingMarker] = useState<CustomMarker | null>(null);
  const [editingMarker, setEditingMarker] = useState<CustomMarker | null>(null);
  const pointerDownRef = useRef<{ x: number; y: number } | null>(null);
  const [hiddenStateServerId, setHiddenStateServerId] = useState(serverId);

  // `MapView` isn't remounted per server (unlike `ControlsPanel`), so the stored state
  // has to be re-read explicitly whenever the active server changes instead of only
  // once at mount — done during render, mirroring the `resetKey` pattern below.
  if (hiddenStateServerId !== serverId) {
    setHiddenStateServerId(serverId);
    setHiddenPlayers(readHiddenPlayers(serverId));
    setHiddenNoteSources(readHiddenNoteSources(serverId));
    setTeamPanelOpen(readTeamPanelOpen(serverId));
    setPlacingMarker(false);
    setPendingMarkerPosition(null);
    setViewingMarker(null);
    setEditingMarker(null);
  }

  const setTeamPanelOpenPersisted = (open: boolean): void => {
    writeTeamPanelOpen(serverId, open);
    setTeamPanelOpen(open);
  };

  const togglePlayerHidden = (id: string): void =>
    setHiddenPlayers((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeHiddenPlayers(serverId, next);
      return next;
    });

  const toggleNoteSource = (source: NoteSource): void =>
    setHiddenNoteSources((current) => {
      const next = new Set(current);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      writeHiddenNoteSources(serverId, next);
      return next;
    });

  const createCustomMarker = async (name: string, description: string): Promise<void> => {
    if (!pendingMarkerPosition) return;
    await customMarkerMutations.createCustomMarker.mutateAsync({
      name,
      description,
      ...pendingMarkerPosition,
    });
    setPendingMarkerPosition(null);
  };

  const saveEditedMarker = async (name: string, description: string): Promise<void> => {
    if (!editingMarker) return;
    await customMarkerMutations.updateCustomMarker.mutateAsync({
      id: editingMarker.id,
      name,
      description,
    });
    setEditingMarker(null);
  };

  const visibleTeamMembers = teamMapMembers.filter((member) => !hiddenPlayers.has(member.id));
  const visibleDeathMarkers = deathMarkers.filter((death) => !hiddenPlayers.has(death.playerId));
  const visibleMapNotes = mapNotes.filter((note) => !hiddenNoteSources.has(note.source));

  const aspect = map ? map.width / map.height : 1;
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

  useEffect(() => {
    if (!placingMarker) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPlacingMarker(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [placingMarker]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    dragRef.current = { x: event.clientX, y: event.clientY };
    pointerDownRef.current = { x: event.clientX, y: event.clientY };
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

    const start = pointerDownRef.current;
    pointerDownRef.current = null;
    if (!start || !map || !placingMarker) return;
    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    // A real drag pans the map instead; only a near-stationary press/release counts
    // as "clicking a spot" to place a marker there.
    if (moved > CLICK_DRAG_TOLERANCE_PX) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setPendingMarkerPosition(
      worldPositionFromScreen(map, transform, fit, {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      }),
    );
    setPlacingMarker(false);
  };

  if (!map) {
    if (error && !isMapNotReady(error))
      return <MapPlaceholder message="Map could not be loaded." />;
    return <MapPlaceholder message="Map is not available yet." />;
  }

  const metrics = mapMetrics(map);
  const cells = metrics.columns * metrics.columns;
  const inset = playableInset(map);
  const canvasTransform = `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`;

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div
        ref={setContainerEl}
        className={cn('rust-map', isPanning && 'is-panning', placingMarker && 'is-placing')}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopPanning}
        onPointerCancel={stopPanning}
      >
        <div
          className="map-canvas"
          style={{ width: fit.width, height: fit.height, transform: canvasTransform }}
        >
          <img src={map.image} alt="Rust server map" />
        </div>
        {/* Rendered outside the zoomed canvas so line width and label size stay
            constant instead of growing with the zoom level; each cell's own
            position/size is computed in container pixels to still track pan/zoom. */}
        <div className="map-grid-overlay">
          {Array.from({ length: cells }, (_, index) => {
            const rect = gridCellRect(index, metrics.columns, fit, transform, inset);
            const isLastColumn = index % metrics.columns === metrics.columns - 1;
            const isLastRow = Math.floor(index / metrics.columns) === metrics.columns - 1;
            return (
              <span
                className={cn(
                  'map-grid-cell',
                  isLastColumn && 'is-last-column',
                  isLastRow && 'is-last-row',
                )}
                key={index}
                style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
              >
                {gridCellLabel(index, metrics.columns)}
              </span>
            );
          })}
        </div>
        {/* A separate layer sharing the canvas's own transform (rather than living
            inside it) so markers/labels paint above the grid overlay instead of
            being trapped underneath it by DOM order. */}
        <div
          className="map-marker-layer"
          style={
            {
              width: fit.width,
              height: fit.height,
              transform: canvasTransform,
              '--zoom': transform.scale,
            } as CSSProperties
          }
        >
          {visibleTeamMembers.map((member) => (
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
          {visibleMapNotes.map((note) => (
            <span
              className="map-marker-anchor"
              key={note.id}
              style={markerPosition(map, note)}
              title="Marker placed in-game"
            >
              <span className="map-marker note">
                <MapPin className="size-3" />
              </span>
            </span>
          ))}
          {customMarkers.map((marker) => (
            <span
              className="map-marker-anchor"
              key={marker.id}
              // `.map-marker-anchor` sets `cursor: default` in map.css, loaded after
              // Tailwind's utilities, so a `cursor-pointer` class would lose to it —
              // an inline style always wins regardless of cascade order.
              style={{ ...markerPosition(map, marker), cursor: 'pointer' }}
              title={marker.description ? `${marker.name}\n${marker.description}` : marker.name}
              // Stopped so clicking a marker neither pans the map nor, while in
              // placement mode, is misread as "place a new marker here".
              onPointerDown={(event) => event.stopPropagation()}
              onPointerUp={(event) => event.stopPropagation()}
              onClick={() => setViewingMarker(marker)}
            >
              <span className="map-marker custom">
                <MapPinPlus className="size-3" />
              </span>
              <span className="map-marker-label">{marker.name}</span>
            </span>
          ))}
          {visibleDeathMarkers.map((death) => (
            <span
              className="map-marker-anchor"
              key={death.id}
              style={markerPosition(map, death)}
              title={`${death.name} died here at ${new Date(death.deathTime * 1000).toLocaleString()}`}
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
              {isTunnelEntranceMonument(monument.token) ? (
                <span className="map-marker monument-tunnel">
                  {isTunnelLinkMonument(monument.token) ? (
                    <TrainFrontTunnel className="size-5" />
                  ) : (
                    <Train className="size-5" />
                  )}
                </span>
              ) : (
                <span className="map-marker-label monument">{monumentLabel(monument.token)}</span>
              )}
            </span>
          ))}
        </div>
        <TeamVisibilityPanel
          members={teamMapMembers}
          hiddenIds={hiddenPlayers}
          onToggle={togglePlayerHidden}
          open={teamPanelOpen}
          onOpenChange={setTeamPanelOpenPersisted}
        />
        <CustomMarkersPanel
          markers={customMarkers}
          hiddenNoteSources={hiddenNoteSources}
          onToggleNoteSource={toggleNoteSource}
          open={customMarkersPanelOpen}
          onOpenChange={setCustomMarkersPanelOpen}
          placing={placingMarker}
          onStartPlacing={() => setPlacingMarker(true)}
          onEdit={setEditingMarker}
          mutations={customMarkerMutations}
        />
        {placingMarker && (
          <div
            className="absolute top-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-border bg-card/90 px-3 py-2 text-sm shadow-lg backdrop-blur-sm"
            onPointerDown={(event) => event.stopPropagation()}
            onPointerUp={(event) => event.stopPropagation()}
          >
            Click on the map to place a marker
            <Button variant="ghost" size="sm" onClick={() => setPlacingMarker(false)}>
              Cancel
            </Button>
          </div>
        )}
      </div>
      {pendingMarkerPosition && (
        <CustomMarkerDialog
          title="Add marker"
          pending={customMarkerMutations.createCustomMarker.isPending}
          onSave={createCustomMarker}
          close={() => setPendingMarkerPosition(null)}
        />
      )}
      {viewingMarker && (
        <CustomMarkerInfoDialog
          marker={viewingMarker}
          onEdit={() => {
            setEditingMarker(viewingMarker);
            setViewingMarker(null);
          }}
          close={() => setViewingMarker(null)}
        />
      )}
      {editingMarker && (
        <CustomMarkerDialog
          title="Edit marker"
          initialName={editingMarker.name}
          initialDescription={editingMarker.description}
          pending={customMarkerMutations.updateCustomMarker.isPending}
          onSave={saveEditedMarker}
          close={() => setEditingMarker(null)}
        />
      )}
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
          <i className="map-dot map-dot-note" />
          Your markers
        </span>
        <span>
          <i className="map-dot map-dot-custom" />
          Custom markers
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
