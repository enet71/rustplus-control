import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Vitest is not running with `globals`, so Testing Library's automatic cleanup is
// not registered. Without this, rendered trees leak between tests.
afterEach(() => {
  cleanup();
  localStorage.clear();
});

// jsdom does not implement ResizeObserver. jsdom also never lays elements out (every
// size is 0), so this stub cannot report real dimensions either way — it only lets
// code that observes an element run without throwing.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

// jsdom does not implement the Pointer Capture API at all, so code that calls these
// (the map's own pan handlers) throws as soon as a test dispatches a pointer event
// directly on the element that owns them, rather than on a descendant that stops
// propagation before it gets there.
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.hasPointerCapture ??= () => false;
