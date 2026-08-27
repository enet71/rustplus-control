import type { DashboardState } from '../../shared/api-types';
import { gridCellLabel, mapMetrics, markerKind, markerPosition } from './map-geometry';
import { isMapNotReady, useMap } from './use-map';

type MapViewProps = {
  serverId: string;
  teamMapMembers: DashboardState['teamMapMembers'];
  mapMarkers: DashboardState['mapMarkers'];
};

function MapPlaceholder({ message }: { message: string }) {
  return (
    <section className="controls">
      <div className="row-title">
        <h2>Map</h2>
        <p className="hint">{message}</p>
      </div>
    </section>
  );
}

export function MapView({ serverId, teamMapMembers, mapMarkers }: MapViewProps) {
  const { data: map, error } = useMap(serverId);

  if (!map) {
    if (error && !isMapNotReady(error))
      return <MapPlaceholder message="Map could not be loaded." />;
    return <MapPlaceholder message="Map is not available yet." />;
  }

  const metrics = mapMetrics(map);
  const cells = metrics.columns * metrics.columns;

  return (
    <section className="controls">
      <div className="row-title">
        <h2>Map</h2>
      </div>
      <div className="rust-map">
        <div className="map-canvas" style={{ aspectRatio: metrics.aspectRatio }}>
          <img src={map.image} alt="Rust server map" style={metrics.imageStyle} />
          <div
            className="map-grid-layer"
            style={{
              gridTemplateColumns: `repeat(${metrics.columns}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${metrics.columns}, minmax(0, 1fr))`,
            }}
          >
            {Array.from({ length: cells }, (_, index) => (
              <span className="map-grid-cell" key={index}>
                {gridCellLabel(index, metrics.columns)}
              </span>
            ))}
          </div>
          <div className="map-marker-layer">
            {teamMapMembers
              .filter((member) => member.isOnline)
              .map((member) => (
                <span
                  className="map-marker team"
                  key={member.id}
                  style={markerPosition(map, member)}
                  title={member.name}
                />
              ))}
            {mapMarkers.map((marker) => (
              <span
                className={`map-marker ${markerKind(marker.type)}`}
                key={marker.id}
                style={markerPosition(map, marker)}
                title={marker.name || 'Map marker'}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="map-legend">
        <span>
          <i className="map-dot map-dot-team" />
          Team
        </span>
        <span>
          <i className="map-dot map-dot-marker" />
          Server markers
        </span>
      </div>
    </section>
  );
}
