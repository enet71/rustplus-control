import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withProviders } from '../../test-utils';
import { parseDeviceBackup, useDeviceBackup } from './use-device-backup';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function backupFile(contents: string): File {
  return new File([contents], 'backup.json', { type: 'application/json' });
}

function renderBackup(report = vi.fn()) {
  const hook = renderHook(() => useDeviceBackup(report), {
    wrapper: ({ children }) => withProviders(children),
  });
  return { ...hook, report };
}

describe('parseDeviceBackup', () => {
  it('explains what to do when the file is not JSON', () => {
    expect(() => parseDeviceBackup('not json')).toThrowError('Choose a valid device backup file.');
  });

  it('returns the parsed backup when the file is valid', () => {
    expect(parseDeviceBackup('{"devices":[]}')).toEqual({ devices: [] });
  });
});

describe('useDeviceBackup', () => {
  it('rejects an unreadable file without sending a request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
    const { result, report } = renderBackup();

    await result.current.importDevices(backupFile('not json'));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledWith('Choose a valid device backup file.');
    await waitFor(() => expect(result.current.importing).toBe(false));
  });

  it('does not send a request when the replacement is not confirmed', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(false));
    const { result } = renderBackup();

    await result.current.importDevices(backupFile('{"devices":[]}'));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uploads a confirmed backup and reports success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
    const { result, report } = renderBackup();

    await result.current.importDevices(backupFile('{"devices":[]}'));

    const [path, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/api/device-backup');
    expect(options.method).toBe('POST');
    expect(report).toHaveBeenCalledWith('Devices imported.');
  });

  it('reports a server rejection instead of claiming success', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: 'Duplicate group membership.' }), { status: 400 }),
        ),
    );
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
    const { result, report } = renderBackup();

    await result.current.importDevices(backupFile('{"devices":[]}'));

    expect(report).toHaveBeenCalledWith('Duplicate group membership.');
    expect(report).not.toHaveBeenCalledWith('Devices imported.');
  });
});
