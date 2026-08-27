import { useQuery } from '@tanstack/react-query';
import { ApiError, apiJson } from '../../shared/http';
import { queryKeys } from '../../shared/query-keys';
import type { RustMap } from '../../shared/api-types';

const NOT_READY_STATUS = 409;
const RETRY_DELAY = 5000;

/** The server answers 409 until it has received the map from Rust+. */
export function isMapNotReady(error: unknown): boolean {
  return error instanceof ApiError && error.status === NOT_READY_STATUS;
}

/**
 * Keyed by the active server so switching servers loads that server's map instead
 * of keeping the previously fetched image. Keeps polling until the map exists,
 * because a freshly connected server reports it as not ready for a while.
 */
export function useMap(serverId: string) {
  return useQuery({
    queryKey: queryKeys.map(serverId),
    queryFn: () => apiJson<RustMap>('/api/map'),
    enabled: Boolean(serverId),
    refetchInterval: (query) => (query.state.data ? false : RETRY_DELAY),
  });
}
