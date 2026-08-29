import type { ConnectionStatus, ServerProfile } from '../../types';
import { errorSummary, logRust } from './rust-log';
import { getRustEntityValue, setRustEntityValue } from './rust-entity-client';

const TEAM_CHAT_POLLING_INTERVAL_MS = 3000;
const TEAM_CHAT_REQUEST_TIMEOUT_MS = 10000;
const TEAM_CHAT_SEEN_LIMIT = 500;
const TEAM_CHAT_MESSAGE_PREFIX = '[rust-control]';

type TeamChatRequest = { rustplus: any; timeout: NodeJS.Timeout | null };
type ChatTarget = { name: string; switchIds: string[]; isGroup: boolean };

/** Polls team chat for `!name` / `!name+` / `!name-` commands and drives the
 *  named switch or group in response, replying in team chat. */
export class TeamChatCommandService {
  private teamChatPolling: NodeJS.Timeout | null = null;
  private teamChatRequest: TeamChatRequest | null = null;
  private readonly processedTeamChatMessages = new Set<string>();

  constructor(
    private readonly getActiveProfile: () => ServerProfile | null,
    private readonly getClient: () => any,
    private readonly getStatus: () => ConnectionStatus,
    private readonly publishEntityState: (entityId: string, value: boolean) => void,
  ) {}

  startTeamChatPolling(rustplus: any): void {
    this.stopTeamChatPolling();
    const poll = () => {
      if (this.getClient() !== rustplus || !this.getStatus().connected || this.teamChatRequest)
        return;
      const request: TeamChatRequest = { rustplus, timeout: null };
      this.teamChatRequest = request;
      request.timeout = setTimeout(() => {
        if (!this.finishTeamChatRequest(request)) return;
        logRust('team chat poll timed out');
      }, TEAM_CHAT_REQUEST_TIMEOUT_MS);
      try {
        rustplus.sendRequest({ getTeamChat: {} }, (message: any) => {
          if (!this.finishTeamChatRequest(request)) return true;
          if (this.getClient() !== rustplus || message.response?.error) return true;
          const messages = message.response?.teamChat?.messages;
          if (!Array.isArray(messages)) return true;
          for (const teamMessage of messages) this.handleTeamChatMessage(rustplus, teamMessage);
          return true;
        });
      } catch (error) {
        this.finishTeamChatRequest(request);
        logRust(`team chat poll failed: ${errorSummary(error)}`);
      }
    };
    poll();
    this.teamChatPolling = setInterval(poll, TEAM_CHAT_POLLING_INTERVAL_MS);
  }

  stopTeamChatPolling(): void {
    if (this.teamChatPolling) clearInterval(this.teamChatPolling);
    this.teamChatPolling = null;
    if (this.teamChatRequest?.timeout) clearTimeout(this.teamChatRequest.timeout);
    this.teamChatRequest = null;
  }

  private finishTeamChatRequest(request: TeamChatRequest): boolean {
    if (this.teamChatRequest !== request) return false;
    if (request.timeout) clearTimeout(request.timeout);
    this.teamChatRequest = null;
    return true;
  }

  handleTeamChatMessage(rustplus: any, teamMessage: any): void {
    const text = typeof teamMessage?.message === 'string' ? teamMessage.message : '';
    const messageId = [teamMessage?.steamId, teamMessage?.time, text].join(':');
    if (!text.startsWith('!') || this.processedTeamChatMessages.has(messageId)) return;
    this.processedTeamChatMessages.add(messageId);
    if (this.processedTeamChatMessages.size > TEAM_CHAT_SEEN_LIMIT)
      this.processedTeamChatMessages.delete(this.processedTeamChatMessages.values().next().value!);

    const command = text.slice(1).trim();
    const action = command.endsWith('+') ? true : command.endsWith('-') ? false : null;
    const targetName = (action === null ? command : command.slice(0, -1)).trim();
    if (!targetName) return;
    const targets = this.findChatTargets(targetName);
    // No matching switch or group: silently ignored rather than replied to, since a
    // `!`-prefixed chat message that isn't actually a command (e.g. ordinary banter)
    // would otherwise get an unwanted "not found" reply.
    if (!targets.length) return;
    if (targets.length > 1) {
      this.sendTeamChatMessage(
        rustplus,
        `Multiple switches or groups have the name: ${targetName}.`,
      );
      return;
    }
    if (action === null) void this.sendChatTargetState(rustplus, targets[0]);
    else void this.setChatTargetValue(rustplus, targets[0], action);
  }

  private findChatTargets(name: string): ChatTarget[] {
    const profile = this.getActiveProfile();
    const normalizedName = name.toLocaleLowerCase();
    if (!profile) return [];
    const switches = profile.devices.filter(
      (device) => device.type === 'switch' && device.name.toLocaleLowerCase() === normalizedName,
    );
    const groups = profile.groups
      .filter((group) => group.name.toLocaleLowerCase() === normalizedName)
      .map((group) => ({
        name: group.name,
        switchIds: group.deviceIds.filter((entityId) =>
          profile.devices.some(
            (device) => device.entityId === entityId && device.type === 'switch',
          ),
        ),
        isGroup: true,
      }))
      .filter((group) => group.switchIds.length);
    return [
      ...switches.map((device) => ({
        name: device.name,
        switchIds: [device.entityId],
        isGroup: false,
      })),
      ...groups,
    ];
  }

  async sendChatTargetState(rustplus: any, target: ChatTarget): Promise<void> {
    const targetLabel = this.chatTargetLabel(target);
    const results = await Promise.all(
      target.switchIds.map(async (entityId) => ({
        entityId,
        value: await getRustEntityValue(rustplus, entityId),
      })),
    );
    if (this.getClient() !== rustplus) return;
    const failedIds = results
      .filter((result) => result.value === null)
      .map((result) => result.entityId);
    if (failedIds.length) {
      this.sendTeamChatMessage(
        rustplus,
        `Unable to get state: ${targetLabel} (failed: ${failedIds.join(', ')}).`,
      );
      return;
    }
    for (const result of results) this.publishEntityState(result.entityId, result.value!);
    this.sendTeamChatMessage(
      rustplus,
      `${targetLabel}: ${results.every((result) => result.value) ? 'on' : 'off'}.`,
    );
  }

  async setChatTargetValue(rustplus: any, target: ChatTarget, enabled: boolean): Promise<void> {
    const targetLabel = this.chatTargetLabel(target);
    const results = await Promise.all(
      target.switchIds.map(async (entityId) => ({
        entityId,
        succeeded: await setRustEntityValue(rustplus, entityId, enabled),
      })),
    );
    if (this.getClient() !== rustplus) return;
    for (const result of results)
      if (result.succeeded) this.publishEntityState(result.entityId, enabled);
    const failedIds = results
      .filter((result) => !result.succeeded)
      .map((result) => result.entityId);
    if (failedIds.length) {
      this.sendTeamChatMessage(
        rustplus,
        `${targetLabel}: ${results.length - failedIds.length}/${results.length} switches changed; failed: ${failedIds.join(', ')}.`,
      );
      return;
    }
    this.sendTeamChatMessage(rustplus, `${targetLabel}: ${enabled ? 'on' : 'off'}.`);
  }

  private chatTargetLabel(target: ChatTarget): string {
    return target.isGroup ? `Group ${target.name}` : target.name;
  }

  private sendTeamChatMessage(rustplus: any, message: string): void {
    if (this.getClient() !== rustplus || !this.getStatus().connected) return;
    try {
      rustplus.sendTeamMessage(`${TEAM_CHAT_MESSAGE_PREFIX} ${message}`);
    } catch (error) {
      logRust(`team chat reply failed: ${errorSummary(error)}`);
    }
  }
}
