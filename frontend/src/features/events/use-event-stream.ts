import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../shared/http';
import { queryKeys } from '../../shared/query-keys';
import type { AppEvent } from '../../shared/api-types';
import { appendEvent, readEventLog, writeEventLog } from './event-log';

const RETRY_DELAY = 3000;

/** Splits a decoded chunk into complete SSE frames, returning the incomplete tail. */
export function splitEventFrames(buffer: string): { frames: string[]; rest: string } {
  const blocks = buffer.split('\n\n');
  const rest = blocks.pop() ?? '';
  return { frames: blocks, rest };
}

/** Returns null for a frame without a data line or with an unreadable payload. */
export function parseEventFrame(frame: string): AppEvent | null {
  const line = frame.split('\n').find((value) => value.startsWith('data: '));
  if (!line) return null;
  try {
    return JSON.parse(line.slice(6)) as AppEvent;
  } catch (error) {
    console.warn('Discarding a malformed map event.', error);
    return null;
  }
}

function showNotification(event: AppEvent): void {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  // Constructing a Notification is how the browser API displays one; there is no
  // separate show() call and the instance is not needed afterwards.
  // oxlint-disable-next-line no-new
  new Notification(event.title, { body: event.body });
}

/**
 * Keeps a single `/api/events` subscription open for the lifetime of the component
 * and reconnects after a drop. Unmounting aborts the request, which closes the
 * response body, and cancels a pending reconnect so no stream outlives the caller.
 */
export function useEventStream(): AppEvent[] {
  const queryClient = useQueryClient();
  const [events, setEvents] = useState<AppEvent[]>(readEventLog);

  useEffect(() => {
    const controller = new AbortController();
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const handle = (event: AppEvent): void => {
      if (event.type === 'pairing-device')
        void queryClient.invalidateQueries({ queryKey: queryKeys.pendingPairings });
      showNotification(event);
      setEvents((current) => appendEvent(current, event));
    };

    const consume = async (): Promise<void> => {
      const response = await apiFetch('/api/events', {
        headers: { Accept: 'text/event-stream' },
        signal: controller.signal,
      });
      if (!response.body) throw new Error('Event stream unavailable.');
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      for (;;) {
        const result = await reader.read();
        if (result.done) return;
        buffer += result.value;
        const { frames, rest } = splitEventFrames(buffer);
        buffer = rest;
        for (const frame of frames) {
          const event = parseEventFrame(frame);
          if (event) handle(event);
        }
      }
    };

    const run = (): void => {
      void consume()
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          console.warn('Map event stream interrupted, reconnecting.', error);
        })
        .finally(() => {
          if (controller.signal.aborted) return;
          retryTimer = setTimeout(run, RETRY_DELAY);
        });
    };

    run();

    return () => {
      controller.abort();
      clearTimeout(retryTimer);
    };
  }, [queryClient]);

  useEffect(() => {
    writeEventLog(events);
  }, [events]);

  return events;
}
