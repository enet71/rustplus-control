import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage, jsonBody } from '../../shared/http';
import { queryKeys } from '../../shared/query-keys';

export type CustomMarkerDraft = { name: string; description: string; x: number; y: number };

/** Every write invalidates the dashboard state query, the single source of truth for
 *  `state.config.customMarkers` — the same pattern `useDeviceMutations` uses. */
export function useCustomMarkerMutations(report: (message: string) => void) {
  const queryClient = useQueryClient();
  const onSuccess = () => queryClient.invalidateQueries({ queryKey: queryKeys.state });
  const onError = (error: unknown) => report(errorMessage(error));

  const createCustomMarker = useMutation({
    mutationFn: (draft: CustomMarkerDraft) =>
      api('/api/custom-markers', { method: 'POST', ...jsonBody(draft) }),
    onSuccess,
    onError,
  });

  const updateCustomMarker = useMutation({
    mutationFn: ({ id, name, description }: { id: string; name: string; description: string }) =>
      api(`/api/custom-markers/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        ...jsonBody({ name, description }),
      }),
    onSuccess,
    onError,
  });

  const deleteCustomMarker = useMutation({
    mutationFn: (id: string) =>
      api(`/api/custom-markers/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess,
    onError,
  });

  return { createCustomMarker, updateCustomMarker, deleteCustomMarker };
}

export type CustomMarkerMutations = ReturnType<typeof useCustomMarkerMutations>;
