import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiJson, errorMessage } from '../../shared/http';
import { queryKeys } from '../../shared/query-keys';
import type { DashboardState } from '../../shared/api-types';

export function useDashboardState() {
  return useQuery({
    queryKey: queryKeys.state,
    queryFn: () => apiJson<DashboardState>('/api/state'),
    refetchInterval: 3000,
  });
}

export function useActivateServer(report: (message: string) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (serverId: string) =>
      api(`/api/servers/${encodeURIComponent(serverId)}/activate`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.state }),
    onError: (error) => report(errorMessage(error)),
  });
}
