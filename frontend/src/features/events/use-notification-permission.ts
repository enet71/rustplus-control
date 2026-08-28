import { useState } from 'react';

export type NotificationAvailability = NotificationPermission | 'unsupported';

export function useNotificationPermission() {
  const [permission, setPermission] = useState<NotificationAvailability>(() =>
    'Notification' in window ? Notification.permission : 'unsupported',
  );

  const request = async (): Promise<void> => {
    if (!('Notification' in window)) return;
    setPermission(await Notification.requestPermission());
  };

  return { permission, request };
}
