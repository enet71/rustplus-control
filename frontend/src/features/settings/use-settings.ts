import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiJson, errorMessage, jsonBody } from '../../shared/http';
import { queryKeys } from '../../shared/query-keys';
import type { Settings } from '../../shared/api-types';

export function useSettings() {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => apiJson<Settings>('/api/settings'),
  });
}

export function useSaveSettings(report: (message: string) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: Settings) =>
      api('/api/settings', { method: 'PUT', ...jsonBody(settings) }),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.settings }),
        queryClient.invalidateQueries({ queryKey: queryKeys.state }),
      ]),
    onError: (error) => report(errorMessage(error)),
  });
}
