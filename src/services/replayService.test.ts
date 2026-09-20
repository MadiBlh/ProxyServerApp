import * as replayService from './replayService';
import * as logManager from './logManager';
import type { LogDetail } from '../types';

jest.mock('./logManager');

describe('Replay Service (src/services/replayService.ts)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('should replay request from stored log detail successfully', async () => {
    const mockLogDetail: LogDetail = {
      id: 'log-101',
      reqMeta: {
        id: 'log-101',
        appId: 'app-1',
        appName: 'App 1',
        backendName: 'Backend',
        routeType: 'backend',
        timestamp: new Date().toISOString(),
        method: 'POST',
        endpoint: '/todos',
        targetUrl: 'http://api.target.com',
        contentType: 'application/json',
        fileExtension: 'json',
        headers: {
          'content-type': 'application/json',
          'host': 'api.target.com',
          'x-custom': 'header-value'
        }
      },
      resMeta: {
        id: 'log-101',
        appId: 'app-1',
        statusCode: 200,
        statusText: 'OK',
        durationMs: 30,
        contentType: 'application/json',
        fileExtension: 'json',
        headers: {},
        error: null
      },
      requestBody: JSON.stringify({ title: 'Task 1' }),
      responseBody: JSON.stringify({ id: 1, title: 'Task 1' })
    };

    (logManager.getLogDetail as jest.Mock).mockReturnValue(mockLogDetail);

    const mockHeaders = new Map<string, string>([
      ['content-type', 'application/json']
    ]);

    global.fetch = jest.fn().mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: mockHeaders,
      text: jest.fn().mockResolvedValue(JSON.stringify({ id: 1, title: 'Task 1' }))
    });

    const result = await replayService.replayRequest({ logId: 'log-101' });

    expect(result.success).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.body).toContain('Task 1');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://api.target.com/todos',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-custom': 'header-value'
        },
        body: JSON.stringify({ title: 'Task 1' })
      })
    );
  });

  it('should apply custom parameters when supplied', async () => {
    (logManager.getLogDetail as jest.Mock).mockReturnValue(null);

    const mockHeaders = new Map<string, string>([['content-type', 'text/plain']]);
    global.fetch = jest.fn().mockResolvedValue({
      status: 204,
      statusText: 'No Content',
      headers: mockHeaders,
      text: jest.fn().mockResolvedValue('')
    });

    const result = await replayService.replayRequest({
      logId: 'none',
      customUrl: 'http://custom.example.com/api',
      customMethod: 'PUT',
      customHeaders: { authorization: 'Bearer token123' },
      customBody: 'custom-data'
    });

    expect(result.success).toBe(true);
    expect(result.statusCode).toBe(204);
    expect(global.fetch).toHaveBeenCalledWith(
      'http://custom.example.com/api',
      expect.objectContaining({
        method: 'PUT',
        headers: { authorization: 'Bearer token123' },
        body: 'custom-data'
      })
    );
  });

  it('should throw an error when no URL can be resolved', async () => {
    (logManager.getLogDetail as jest.Mock).mockReturnValue(null);

    await expect(
      replayService.replayRequest({ logId: 'missing-log' })
    ).rejects.toThrow('No target URL available for replay');
  });

  it('should return failure result when fetch encounters network error', async () => {
    (logManager.getLogDetail as jest.Mock).mockReturnValue(null);

    global.fetch = jest.fn().mockRejectedValue(new Error('Connection refused'));

    const result = await replayService.replayRequest({
      logId: 'none',
      customUrl: 'http://offline.server.local'
    });

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(500);
    expect(result.error).toBe('Connection refused');
    expect(result.body).toContain('Replay Execution Failed');
  });
});
