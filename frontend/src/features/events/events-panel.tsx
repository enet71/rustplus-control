import type { AppEvent } from '../../shared/api-types';
import type { NotificationAvailability } from './use-notification-permission';

type EventsPanelProps = {
  events: AppEvent[];
  discordConfigured: boolean;
  discordAvailable: boolean;
  notificationPermission: NotificationAvailability;
  onEnableNotifications: () => void;
  onOpenDiscord: () => void;
};

function notificationHint(permission: NotificationAvailability): string {
  if (permission === 'unsupported') return 'Browser notifications are not supported.';
  if (permission === 'granted') return 'Browser notifications are enabled.';
  return 'Allow notifications to receive map events.';
}

export function EventsPanel({
  events,
  discordConfigured,
  discordAvailable,
  notificationPermission,
  onEnableNotifications,
  onOpenDiscord,
}: EventsPanelProps) {
  return (
    <section className="notifications">
      <div className="row-title">
        <h2>Map events</h2>
        <div className="notification-actions">
          <button
            type="button"
            className="secondary"
            disabled={!discordAvailable}
            onClick={onOpenDiscord}
          >
            Discord
          </button>
          <button
            type="button"
            className="secondary"
            disabled={
              notificationPermission === 'unsupported' || notificationPermission === 'granted'
            }
            onClick={onEnableNotifications}
          >
            Enable notifications
          </button>
        </div>
      </div>
      <p className="hint">{notificationHint(notificationPermission)}</p>
      <p className="hint">
        {discordConfigured
          ? 'Discord alarm notifications are enabled.'
          : 'Discord alarm notifications are not configured.'}
      </p>
      <div className="event-list">
        {events.map((event) => (
          <p key={event.id}>
            <span>
              <strong>{event.title}</strong> {event.body}
            </span>
            <time>{new Date(event.createdAt).toLocaleString()}</time>
          </p>
        ))}
      </div>
    </section>
  );
}
