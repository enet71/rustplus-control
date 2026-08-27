import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withProviders } from '../../test-utils';
import { parseEventFrame, splitEventFrames, useEventStream } from './use-event-stream';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function frame(id: string, title: string): string {
  return `data: ${JSON.stringify({ id, title, body: 'b', type: 'map', createdAt: '2026-01-01T00:00:00.000Z' })}\n\n`;
}

/** Emits the given chunks, then stays open until aborted. */
function streamResponse(chunks: string[], signal?: AbortSignal | null): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      signal?.addEventListener('abort', () => controller.close());
    },
  });
  return new Response(body, { status: 200 });
}

describe('splitEventFrames', () => {
  it('returns complete frames and keeps the partial tail buffered', () => {
    expect(splitEventFrames('data: 1\n\ndata: 2\n\ndata: 3')).toEqual({
      frames: ['data: 1', 'data: 2'],
      rest: 'data: 3',
    });
  });

  it('buffers everything when no frame is complete yet', () => {
    expect(splitEventFrames('data: partial')).toEqual({ frames: [], rest: 'data: partial' });
  });
});

describe('parseEventFrame', () => {
  it('reads the data line out of a multi-line frame', () => {
    const parsed = parseEventFrame(`event: map\nid: 7\ndata: {"id":"7","title":"Cargo"}`);

    expect(parsed).toMatchObject({ id: '7', title: 'Cargo' });
  });

  it('returns null for a frame without a data line', () => {
    expect(parseEventFrame('event: ping\nid: 3')).toBeNull();
  });

  it('reports an unreadable payload instead of throwing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(parseEventFrame('data: {not json')).toBeNull();
    expect(warn).toHaveBeenCalled();
  });
});

describe('useEventStream', () => {
  it('collects events newest first as frames arrive', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, options: RequestInit) =>
        Promise.resolve(
          streamResponse([frame('1', 'First'), frame('2', 'Second')], options.signal),
        ),
      ),
    );

    const { result } = renderHook(() => useEventStream(), {
      wrapper: ({ children }) => withProviders(children),
    });

    await waitFor(() => expect(result.current).toHaveLength(2));
    expect(result.current.map((event) => event.title)).toEqual(['Second', 'First']);
  });

  it('keeps the stream alive when a single event is malformed', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, options: RequestInit) =>
        Promise.resolve(
          streamResponse(['data: {broken\n\n', frame('2', 'Second')], options.signal),
        ),
      ),
    );

    const { result } = renderHook(() => useEventStream(), {
      wrapper: ({ children }) => withProviders(children),
    });

    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current[0].title).toBe('Second');
  });

  it('aborts the request on unmount so no stream outlives the component', async () => {
    const signals: AbortSignal[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, options: RequestInit) => {
        if (options.signal) signals.push(options.signal);
        return Promise.resolve(streamResponse([frame('1', 'First')], options.signal));
      }),
    );

    const { result, unmount } = renderHook(() => useEventStream(), {
      wrapper: ({ children }) => withProviders(children),
    });
    await waitFor(() => expect(result.current).toHaveLength(1));

    expect(signals.some((signal) => signal.aborted)).toBe(false);
    unmount();

    expect(signals.length).toBeGreaterThan(0);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it('restores the persisted log on mount', async () => {
    localStorage.setItem(
      'rustplus-control.events',
      JSON.stringify([
        { id: 'old', title: 'Earlier', body: 'b', type: 'map', createdAt: '2026-01-01T00:00:00Z' },
      ]),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, options: RequestInit) =>
        Promise.resolve(streamResponse([], options.signal)),
      ),
    );

    const { result } = renderHook(() => useEventStream(), {
      wrapper: ({ children }) => withProviders(children),
    });

    expect(result.current.map((event) => event.title)).toEqual(['Earlier']);
  });
});
