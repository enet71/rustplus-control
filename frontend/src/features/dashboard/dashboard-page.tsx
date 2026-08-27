import { useRef, useState, type ChangeEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '../../shared/http';
import { clearAccessToken } from '../../shared/session';
import type { Device, DeviceGroup } from '../../shared/api-types';
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
      <main>
        <section className="controls">
          <div className="row-title">
            <h2>Electrical control</h2>
          </div>
          <p className="hint" role="alert">
            {errorMessage(stateError)}
          </p>
        </section>
      </main>
    );

  if (!state)
    return (
      <main>
        <p className="hint">Loading...</p>
      </main>
    );

  return (
    <main>
      <div className="dashboard-layout">
        <div className="dashboard-primary">
          <header>
            <div>
              <p className="eyebrow">RUST+ COMPANION</p>
              <h1>Electrical control</h1>
            </div>
            <div className="header-actions">
              <span className={`status ${state.connected ? 'online' : ''}`}>{state.message}</span>
              <button className="secondary" onClick={() => setDialog({ kind: 'settings' })}>
                Settings
              </button>
              <button className="secondary" onClick={signOut}>
                Sign out
              </button>
            </div>
          </header>
          {fcmStatus.data?.registrationAvailable && (
            <FcmPanel
              status={fcmStatus.data}
              onRegister={() => pairingMutations.registerFcm.mutate()}
              onReset={() => pairingMutations.logoutFcm.mutate()}
              registering={pairingMutations.registerFcm.isPending}
              resetting={pairingMutations.logoutFcm.isPending}
            />
          )}
          <section className="server-bar">
            <label>
              Active server
              <select
                value={state.config.activeServerId || ''}
                onChange={(event) => activateServer.mutate(event.target.value)}
              >
                {!state.config.servers.length && <option>No paired servers</option>}
                {state.config.servers.map((server) => (
                  <option key={server.id} value={server.id}>
                    {server.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="feedback hint" role="status">
              {feedback}
            </p>
          </section>
          <nav className="view-tabs">
            <button
              className={`view-tab ${view === 'controls' ? 'is-active' : ''}`}
              onClick={() => setView('controls')}
            >
              Controls
            </button>
            <button
              className={`view-tab ${view === 'map' ? 'is-active' : ''}`}
              onClick={() => setView('map')}
            >
              Map
            </button>
          </nav>
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
        <EventsPanel
          events={events}
          discordConfigured={state.config.discordConfigured}
          discordAvailable={Boolean(state.config.activeServerId)}
          notificationPermission={notifications.permission}
          onEnableNotifications={() => void notifications.request()}
          onOpenDiscord={() => setDialog({ kind: 'discord' })}
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
          devices={state.config.devices}
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
