import express from 'express';
import request from 'supertest';
import apiRouter from './api';
import * as storageManager from '../services/storageManager';

jest.mock('../services/configManager');
jest.mock('../services/logManager');
jest.mock('../services/settingsManager');
jest.mock('../services/redirectProxyManager');
jest.mock('../services/replayService');
jest.mock('../services/proxyEngine');
jest.mock('../services/mockManager');
jest.mock('../services/storageManager');

describe('Storage API Endpoints (/dashboard-api/storage)', () => {
  let app: express.Express;

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use('/dashboard-api', apiRouter);
  });

  describe('GET /dashboard-api/storage/stats', () => {
    it('should return storage metrics', async () => {
      const mockStats = {
        logsDir: '/app/logs',
        headersDir: '/app/headers',
        archivesDir: '/app/archives',
        logsSizeBytes: 1048576,
        headersSizeBytes: 524288,
        archivesSizeBytes: 2097152,
        totalSizeBytes: 3670016,
        formattedTotalSize: '3.5 MB',
        totalTransactions: 142,
        activeDatePartitions: ['2026-09-20'],
        archivedDatePartitions: ['2026-09-19']
      };
      (storageManager.getStorageStats as jest.Mock).mockReturnValue(mockStats);

      const res = await request(app).get('/dashboard-api/storage/stats');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockStats);
    });

    it('should handle error when fetching stats', async () => {
      (storageManager.getStorageStats as jest.Mock).mockImplementation(() => {
        throw new Error('Disk unreadable');
      });

      const res = await request(app).get('/dashboard-api/storage/stats');
      expect(res.status).toBe(500);
      expect(res.body.error).toContain('Disk unreadable');
    });
  });

  describe('POST /dashboard-api/storage/vacuum', () => {
    it('should execute vacuum and return results', async () => {
      const mockResult = {
        cleanedDateFolders: 3,
        freedBytes: 0,
        remainingDateFolders: 2
      };
      (storageManager.vacuumEmptyDirectories as jest.Mock).mockReturnValue(mockResult);

      const res = await request(app).post('/dashboard-api/storage/vacuum');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockResult);
    });
  });

  describe('POST /dashboard-api/storage/retention/apply', () => {
    it('should apply retention policy and return affected count', async () => {
      const mockResult = {
        processedPartitions: ['2026-08-01'],
        actionTaken: 'archive',
        affectedTransactionsCount: 25
      };
      (storageManager.applyRetentionPolicy as jest.Mock).mockReturnValue(mockResult);

      const res = await request(app)
        .post('/dashboard-api/storage/retention/apply')
        .send({ retentionDays: 30, retentionAction: 'archive' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockResult);
      expect(storageManager.applyRetentionPolicy).toHaveBeenCalledWith(30, 'archive');
    });
  });
});
