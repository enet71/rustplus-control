import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage, jsonBody } from '../../shared/http';
import { queryKeys } from '../../shared/query-keys';

export type MoveDirection = -1 | 1;
export type MoveTarget = { type: 'device' | 'group'; id: string; direction: MoveDirection };
export type GroupDraft = { id?: string; name: string; deviceIds: string[] };

/**
 * Every device and group write invalidates the dashboard state query, which is the
 * single source of truth for device states. Callers use the `isPending` helpers to
 * keep a control disabled while its own request is in flight.
 */
export function useDeviceMutations(report: (message: string) => void) {
  const queryClient = useQueryClient();
  const onSuccess = () => queryClient.invalidateQueries({ queryKey: queryKeys.state });
  const onError = (error: unknown) => report(errorMessage(error));

  const setDeviceEnabled = useMutation({
    mutationFn: ({ entityId, enabled }: { entityId: string; enabled: boolean }) =>
      api(`/api/devices/${encodeURIComponent(entityId)}`, {
        method: 'POST',
        ...jsonBody({ enabled }),
      }),
    onSuccess,
    onError,
  });

  const setGroupEnabled = useMutation({
    mutationFn: ({ groupId, enabled }: { groupId: string; enabled: boolean }) =>
      api(`/api/groups/${encodeURIComponent(groupId)}/switch`, {
        method: 'POST',
        ...jsonBody({ enabled }),
      }),
    onSuccess,
    onError,
  });

  const renameDevice = useMutation({
    mutationFn: ({ entityId, name }: { entityId: string; name: string }) =>
      api(`/api/devices/${encodeURIComponent(entityId)}`, {
        method: 'PATCH',
        ...jsonBody({ name }),
      }),
    onSuccess,
    onError,
  });

  const saveGroup = useMutation({
    mutationFn: ({ id, name, deviceIds }: GroupDraft) =>
      api(id ? `/api/groups/${encodeURIComponent(id)}` : '/api/groups', {
        method: id ? 'PATCH' : 'POST',
        ...jsonBody({ name, deviceIds }),
      }),
    onSuccess,
    onError,
  });

  const moveItem = useMutation({
    mutationFn: ({ type, id, direction }: MoveTarget) =>
      api(`/api/items/${encodeURIComponent(type)}/${encodeURIComponent(id)}/move`, {
        method: 'POST',
        ...jsonBody({ direction }),
      }),
    onSuccess,
    onError,
  });

  return {
    setDeviceEnabled,
    setGroupEnabled,
    renameDevice,
    saveGroup,
    moveItem,
    isDevicePending: (entityId: string) =>
      setDeviceEnabled.isPending && setDeviceEnabled.variables?.entityId === entityId,
    isGroupPending: (groupId: string) =>
      setGroupEnabled.isPending && setGroupEnabled.variables?.groupId === groupId,
  };
}

export type DeviceMutations = ReturnType<typeof useDeviceMutations>;
