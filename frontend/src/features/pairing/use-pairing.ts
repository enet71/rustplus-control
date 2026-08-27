import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiJson, errorMessage, jsonBody } from '../../shared/http';
import { queryKeys } from '../../shared/query-keys';
import type { DeviceType, FcmStatus, PendingPairing } from '../../shared/api-types';

export function useFcmStatus() {
  return useQuery({
    queryKey: queryKeys.fcmStatus,
    queryFn: () => apiJson<FcmStatus>('/api/fcm/status'),
    refetchInterval: 3000,
  });
}

export function usePendingPairings() {
  return useQuery({
    queryKey: queryKeys.pendingPairings,
    queryFn: () => apiJson<PendingPairing[]>('/api/pairings/pending'),
    refetchInterval: 5000,
  });
}

/**
 * Pairing writes change the FCM registration, the pending queue and the paired
 * device list at once, so each one refreshes all three queries.
 */
export function usePairingMutations(report: (message: string) => void) {
  const queryClient = useQueryClient();
  const onSuccess = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.fcmStatus }),
      queryClient.invalidateQueries({ queryKey: queryKeys.pendingPairings }),
      queryClient.invalidateQueries({ queryKey: queryKeys.state }),
    ]);
  const onError = (error: unknown) => report(errorMessage(error));

  const registerFcm = useMutation({
    mutationFn: () => api('/api/fcm/register', { method: 'POST' }),
    onSuccess,
    onError,
  });

  const logoutFcm = useMutation({
    mutationFn: () => api('/api/fcm/logout', { method: 'POST' }),
    onSuccess,
    onError,
  });

  const acceptPairing = useMutation({
    mutationFn: ({ id, name, type }: { id: string; name: string; type: DeviceType }) =>
      api(`/api/pairings/${encodeURIComponent(id)}/accept`, {
        method: 'POST',
        ...jsonBody({ name, type }),
      }),
    onSuccess,
    onError,
  });

  const rejectPairing = useMutation({
    mutationFn: (id: string) =>
      api(`/api/pairings/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess,
    onError,
  });

  return { registerFcm, logoutFcm, acceptPairing, rejectPairing };
}
