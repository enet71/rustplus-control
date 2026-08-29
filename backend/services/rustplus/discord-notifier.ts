import { logRust } from './rust-log';

export async function postDiscordAlarm(webhookUrl: string, content: string): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, allowed_mentions: { parse: ['everyone'] } }),
      signal: controller.signal,
    });
    if (!response.ok) logRust(`Discord alarm notification failed (${response.status})`);
  } catch (error) {
    logRust(`Discord alarm notification failed: ${(error as Error)?.name || 'Error'}`);
  } finally {
    clearTimeout(timeout);
  }
}
