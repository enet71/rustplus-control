import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, apiJson, errorMessage, jsonBody } from '../../shared/http';
import { queryKeys } from '../../shared/query-keys';

const INVALID_BACKUP = 'Choose a valid device backup file.';

export function parseDeviceBackup(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(INVALID_BACKUP);
  }
}

function backupFileName(now: Date): string {
  return `rustplus-devices-${now.toISOString().slice(0, 10)}.json`;
}

export function useDeviceBackup(report: (message: string) => void) {
  const queryClient = useQueryClient();
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);

  const exportDevices = async (): Promise<void> => {
    setExporting(true);
    try {
      const backup = await apiJson<unknown>('/api/device-backup');
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const download = document.createElement('a');
      download.href = url;
      download.download = backupFileName(new Date());
      download.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      report(errorMessage(error));
    } finally {
      setExporting(false);
    }
  };

  const importDevices = async (file: File): Promise<void> => {
    setImporting(true);
    try {
      const backup = parseDeviceBackup(await file.text());
      if (!window.confirm('Replace the current devices and groups with this backup?')) return;
      await api('/api/device-backup', { method: 'POST', ...jsonBody(backup) });
      report('Devices imported.');
      await queryClient.invalidateQueries({ queryKey: queryKeys.state });
    } catch (error) {
      report(errorMessage(error));
    } finally {
      setImporting(false);
    }
  };

  return { exportDevices, importDevices, exporting, importing };
}
