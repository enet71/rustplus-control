import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AppEvent } from '../../shared/api-types';
import { EventsPanel } from './events-panel';

function event(overrides: Partial<AppEvent> = {}): AppEvent {
  return {
    id: '1',
    title: 'Event',
    body: 'Something happened',
    type: 5,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('EventsPanel', () => {
  it('shows the grid square baked into a player-death event body', () => {
    render(
      <EventsPanel
        events={[
          event({
            id: 'death',
            title: 'Player death',
            body: 'Alice died in K14',
            type: 'player-death',
          }),
        ]}
        discordConfigured={false}
        notificationPermission="default"
        onEnableNotifications={vi.fn()}
      />,
    );

    expect(screen.queryByText(/Alice died in K14/)).not.toBeNull();
  });
});
