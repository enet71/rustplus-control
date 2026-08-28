import { useSyncExternalStore } from 'react';

const ACCESS_TOKEN_KEY = 'rustplus-control.access-token';
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function getAccessToken(): string {
  return localStorage.getItem(ACCESS_TOKEN_KEY) || '';
}

export function saveAccessToken(token: string): void {
  localStorage.setItem(ACCESS_TOKEN_KEY, token);
  notify();
}

export function clearAccessToken(): void {
  if (!localStorage.getItem(ACCESS_TOKEN_KEY)) return;
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

export function useAccessToken(): string {
  return useSyncExternalStore(subscribe, getAccessToken);
}
