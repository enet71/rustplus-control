export const queryKeys = {
  state: ['state'] as const,
  fcmStatus: ['fcm-status'] as const,
  pendingPairings: ['pending-pairings'] as const,
  settings: ['settings'] as const,
  map: (serverId: string) => ['map', serverId] as const,
};
