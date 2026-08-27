import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage, jsonBody } from '../../shared/http';
import { queryKeys } from '../../shared/query-keys';

export function useSaveDiscordWebhook(report: (message: string) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (url: string) =>
      api('/api/discord-webhook', { method: 'PUT', ...jsonBody({ url: url.trim() }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.state }),
    onError: (error) => report(errorMessage(error)),
  });
}
