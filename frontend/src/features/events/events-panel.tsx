import { Button } from '@/components/ui/button';
import type { AppEvent } from '../../shared/api-types';
import type { NotificationAvailability } from './use-notification-permission';

type EventsPanelProps = {
  events: AppEvent[];
  discordConfigured: boolean;
  notificationPermission: NotificationAvailability;
  onEnableNotifications: () => void;
};

function notificationHint(permission: NotificationAvailability): string {
  if (permission === 'unsupported') return 'Browser notifications are not supported.';
  if (permission === 'granted') return 'Browser notifications are enabled.';
  return 'Allow notifications to receive map events.';
}

export function EventsPanel({
  events,
  discordConfigured,
  notificationPermission,
  onEnableNotifications,
}: EventsPanelProps) {
  return (
    <section className="my-8 mr-8 ml-8 flex h-[calc(100%-4rem)] w-[340px] shrink-0 flex-col gap-2 rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">Map events</h2>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={
            notificationPermission === 'unsupported' || notificationPermission === 'granted'
          }
          onClick={onEnableNotifications}
        >
          Enable notifications
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">{notificationHint(notificationPermission)}</p>
      <p className="text-sm text-muted-foreground">
        {discordConfigured
          ? 'Discord alarm notifications are enabled.'
          : 'Discord alarm notifications are not configured.'}
      </p>
      <div className="mt-1 grid min-h-0 flex-1 content-start gap-1.5 overflow-y-auto pr-2">
        {events.map((event) => (
          <div key={event.id} className="border-l-2 border-primary pl-2.5">
            <div className="flex items-baseline justify-between gap-2.5">
              <strong className="text-sm text-foreground">{event.title}</strong>
              <time className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">
                {new Date(event.createdAt).toLocaleString()}
              </time>
            </div>
            <p className="text-sm text-muted-foreground">{event.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
