import { useRef, useState, type ChangeEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { LogOut, MessageCircle, Settings as SettingsIcon, Zap } from 'lucide-react';
import { errorMessage } from '../../shared/http';
import { clearAccessToken } from '../../shared/session';
import type { Device, DeviceGroup } from '../../shared/api-types';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { availableGroupDevices } from '../devices/control-items';
import { ControlsPanel } from '../devices/controls-panel';
import { DeviceDialog } from '../devices/device-dialog';
import { GroupDialog } from '../devices/group-dialog';
import { useDeviceBackup } from '../devices/use-device-backup';
import { useDeviceMutations } from '../devices/use-devices';
import { DiscordDialog } from '../events/discord-dialog';
import { EventsPanel } from '../events/events-panel';
import { useEventStream } from '../events/use-event-stream';
import { useNotificationPermission } from '../events/use-notification-permission';
import { MapView } from '../map/map-view';
import { FcmPanel } from '../pairing/fcm-panel';
import { PairingDialog } from '../pairing/pairing-dialog';
import { useFcmStatus, usePairingMutations, usePendingPairings } from '../pairing/use-pairing';
import { SettingsDialog } from '../settings/settings-dialog';
import { useActivateServer, useDashboardState } from './use-dashboard-state';

type View = 'controls' | 'map';
type Dialog =
  | { kind: 'settings' }
  | { kind: 'discord' }
  | { kind: 'device'; device: Device }
  | { kind: 'group'; group?: DeviceGroup }
  | null;

export function DashboardPage() {
  const queryClient = useQueryClient();
  const { data: state, error: stateError } = useDashboardState();
  const fcmStatus = useFcmStatus();
  const pendingPairings = usePendingPairings();
  const [feedback, setFeedback] = useState('');
  const [view, setView] = useState<View>('controls');
  const [dialog, setDialog] = useState<Dialog>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const deviceMutations = useDeviceMutations(setFeedback);
  const pairingMutations = usePairingMutations(setFeedback);
  const activateServer = useActivateServer(setFeedback);
  const backup = useDeviceBackup(setFeedback);
  const events = useEventStream();
  const notifications = useNotificationPermission();

  const pairing = pendingPairings.data?.[0];
  const pairingSubmitting =
    pairingMutations.acceptPairing.isPending || pairingMutations.rejectPairing.isPending;

  const signOut = (): void => {
    clearAccessToken();
    queryClient.clear();
  };

  const chooseImportFile = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void backup.importDevices(file);
  };

  if (stateError)
    return (
      <main className="mx-auto w-full max-w-[640px] px-5 py-10">
        <h2 className="text-lg font-semibold">Electrical control</h2>
        <p className="mt-3 text-sm text-destructive" role="alert">
          {errorMessage(stateError)}
        </p>
      </main>
    );

  if (!state)
    return (
      <main className="px-5 py-10">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </main>
    );

  return (
    <main className="w-full">
      <div className="flex h-screen items-stretch">
        <aside className="flex h-screen w-[260px] shrink-0 flex-col gap-5 overflow-y-auto border-r border-dashed border-border p-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                <Zap className="size-4" fill="currentColor" />
              </span>
              <div className="flex flex-col">
                <h1 className="text-[15px] leading-tight font-semibold">Electrical control</h1>
                <p className="text-[10px] tracking-[0.15em] text-muted-foreground">
                  RUST+ COMPANION
                </p>
              </div>
            </div>
            <span
              className={cn(
                'size-2.5 shrink-0 rounded-full',
                state.connected ? 'bg-success' : 'bg-warning',
              )}
              title={state.message}
            />
          </div>
          <p className={cn('-mt-3 text-xs', state.connected ? 'text-success' : 'text-warning')}>
            {state.message}
          </p>

          {fcmStatus.data?.registrationAvailable && (
            <div className="border-t border-dashed border-border pt-5">
              <p className="mb-3 text-[11px] font-medium tracking-[0.1em] text-muted-foreground uppercase">
                Pairing
              </p>
              <FcmPanel
                status={fcmStatus.data}
                onRegister={() => pairingMutations.registerFcm.mutate()}
                onReset={() => pairingMutations.logoutFcm.mutate()}
                registering={pairingMutations.registerFcm.isPending}
                resetting={pairingMutations.logoutFcm.isPending}
              />
            </div>
          )}

          <div className="border-t border-dashed border-border pt-5">
            <p className="mb-3 text-[11px] font-medium tracking-[0.1em] text-muted-foreground uppercase">
              Server
            </p>
            <div className="grid gap-1.5">
              <Label htmlFor="active-server" className="sr-only">
                Active server
              </Label>
              <Select
                value={state.config.activeServerId || ''}
                onValueChange={(value) => activateServer.mutate(value)}
              >
                <SelectTrigger id="active-server">
                  <SelectValue placeholder="No paired servers" />
                </SelectTrigger>
                <SelectContent>
                  {state.config.servers.map((server) => (
                    <SelectItem key={server.id} value={server.id}>
                      {server.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="min-h-[18px] text-sm text-muted-foreground" role="status">
                {feedback}
              </p>
            </div>
          </div>

          <div className="mt-auto border-t border-dashed border-border pt-5">
            <p className="mb-2 text-[11px] font-medium tracking-[0.1em] text-muted-foreground uppercase">
              General
            </p>
            <div className="flex flex-col gap-1">
              <Button
                variant="ghost"
                className="justify-start gap-3 px-3 text-muted-foreground hover:text-foreground"
                disabled={!state.config.activeServerId}
                onClick={() => setDialog({ kind: 'discord' })}
              >
                <MessageCircle className="size-4" /> Discord
              </Button>
              <Button
                variant="ghost"
                className="justify-start gap-3 px-3 text-muted-foreground hover:text-foreground"
                onClick={() => setDialog({ kind: 'settings' })}
              >
                <SettingsIcon className="size-4" /> Settings
              </Button>
              <Button
                variant="ghost"
                className="justify-start gap-3 px-3 text-muted-foreground hover:text-foreground"
                onClick={signOut}
              >
                <LogOut className="size-4" /> Sign out
              </Button>
            </div>
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border px-8 py-5">
            <h2 className="text-lg font-semibold">{view === 'controls' ? 'Controls' : 'Map'}</h2>
            <Tabs value={view} onValueChange={(value) => setView(value as View)}>
              <TabsList className="border-b-0">
                <TabsTrigger value="controls">Controls</TabsTrigger>
                <TabsTrigger value="map">Map</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div
            className={cn(
              'min-h-0 flex-1 p-8',
              view === 'controls' ? 'overflow-y-auto' : 'flex flex-col overflow-hidden',
            )}
          >
            {view === 'controls' ? (
              <ControlsPanel
                key={state.config.activeServerId || ''}
                state={state}
                mutations={deviceMutations}
                onRenameDevice={(device) => setDialog({ kind: 'device', device })}
                onEditGroup={(group) => setDialog({ kind: 'group', group })}
                onNewGroup={() => setDialog({ kind: 'group' })}
                onImport={() => importInputRef.current?.click()}
                onExport={() => void backup.exportDevices()}
                importing={backup.importing}
                exporting={backup.exporting}
              />
            ) : (
              <MapView
                serverId={state.config.activeServerId || ''}
                teamMapMembers={state.teamMapMembers}
                mapMarkers={state.mapMarkers}
              />
            )}
          </div>
        </div>
        <EventsPanel
          events={events}
          discordConfigured={state.config.discordConfigured}
          notificationPermission={notifications.permission}
          onEnableNotifications={() => void notifications.request()}
        />
      </div>
      {dialog?.kind === 'settings' && (
        <SettingsDialog close={() => setDialog(null)} report={setFeedback} />
      )}
      {dialog?.kind === 'discord' && (
        <DiscordDialog close={() => setDialog(null)} report={setFeedback} />
      )}
      {dialog?.kind === 'device' && (
        <DeviceDialog
          device={dialog.device}
          mutations={deviceMutations}
          close={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'group' && (
        <GroupDialog
          group={dialog.group}
          devices={availableGroupDevices(
            state.config.devices,
            state.config.groups,
            dialog.group?.id || null,
          )}
          mutations={deviceMutations}
          close={() => setDialog(null)}
        />
      )}
      {pairing && (
        <PairingDialog
          key={pairing.id}
          pairing={pairing}
          submitting={pairingSubmitting}
          accept={async (name, type) => {
            await pairingMutations.acceptPairing.mutateAsync({ id: pairing.id, name, type });
          }}
          reject={async () => {
            await pairingMutations.rejectPairing.mutateAsync(pairing.id);
          }}
        />
      )}
      <input
        ref={importInputRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={chooseImportFile}
      />
    </main>
  );
}
