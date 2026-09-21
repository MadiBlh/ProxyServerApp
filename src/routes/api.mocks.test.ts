import express from 'express';
import request from 'supertest';
import apiRouter from './api';
import * as mockManager from '../services/mockManager';
import { MockRule } from '../types';

jest.mock('../services/configManager');
jest.mock('../services/logManager');
jest.mock('../services/settingsManager');
jest.mock('../services/redirectProxyManager');
jest.mock('../services/replayService');
jest.mock('../services/proxyEngine');
jest.mock('../services/mockManager');

describe('Mock API Endpoints (/dashboard-api/mocks)', () => {
  let app: express.Express;

  const sampleMock: MockRule = {
    id: 'mock-1',
    name: 'Get Users Mock',
    enabled: true,
    appId: '*',
    method: 'GET',
    urlPattern: '/api/v1/users',
    matchType: 'exact',
    responseType: 'mock',
    statusCode: 200,
    delayMs: 150,
    headers: { 'Content-Type': 'application/json' },
    body: '{"users": []}',
    createdAt: '2026-09-20T00:00:00.000Z',
    updatedAt: '2026-09-20T00:00:00.000Z'
  };

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use('/dashboard-api', apiRouter);
  });

  describe('GET /dashboard-api/mocks', () => {
    it('should return all mock rules without query param', async () => {
      (mockManager.getMockRules as jest.Mock).mockReturnValue([sampleMock]);

      const res = await request(app).get('/dashboard-api/mocks');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([sampleMock]);
      expect(mockManager.getMockRules).toHaveBeenCalledWith(undefined);
    });

    it('should filter mock rules by appId query param', async () => {
      (mockManager.getMockRules as jest.Mock).mockReturnValue([sampleMock]);

      const res = await request(app).get('/dashboard-api/mocks?appId=app-123');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([sampleMock]);
      expect(mockManager.getMockRules).toHaveBeenCalledWith('app-123');
    });

    it('should handle internal errors gracefully', async () => {
      (mockManager.getMockRules as jest.Mock).mockImplementation(() => {
        throw new Error('Disk read error');
      });

      const res = await request(app).get('/dashboard-api/mocks');
      expect(res.status).toBe(500);
      expect(res.body.error).toContain('Disk read error');
    });
  });

  describe('GET /dashboard-api/mocks/stats', () => {
    it('should return mock rules stats', async () => {
      const sampleStats = { totalRules: 5, activeRules: 3, inactiveRules: 2 };
      (mockManager.getMockStats as jest.Mock).mockReturnValue(sampleStats);

      const res = await request(app).get('/dashboard-api/mocks/stats');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(sampleStats);
    });

    it('should handle stats error', async () => {
      (mockManager.getMockStats as jest.Mock).mockImplementation(() => {
        throw new Error('Stats failure');
      });

      const res = await request(app).get('/dashboard-api/mocks/stats');
      expect(res.status).toBe(500);
      expect(res.body.error).toContain('Stats failure');
    });
  });

  describe('GET /dashboard-api/mocks/:id', () => {
    it('should return rule if found', async () => {
      (mockManager.getMockRuleById as jest.Mock).mockReturnValue(sampleMock);

      const res = await request(app).get('/dashboard-api/mocks/mock-1');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(sampleMock);
    });

    it('should return 404 if rule not found', async () => {
      (mockManager.getMockRuleById as jest.Mock).mockReturnValue(null);

      const res = await request(app).get('/dashboard-api/mocks/non-existent');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Mock rule not found');
    });
  });

  describe('POST /dashboard-api/mocks', () => {
    it('should return 400 if urlPattern is missing', async () => {
      const res = await request(app)
        .post('/dashboard-api/mocks')
        .send({ name: 'Invalid rule' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('urlPattern is required');
    });

    it('should successfully create a mock rule', async () => {
      (mockManager.createMockRule as jest.Mock).mockReturnValue(sampleMock);

      const res = await request(app)
        .post('/dashboard-api/mocks')
        .send({
          name: 'Get Users Mock',
          urlPattern: '/api/v1/users',
          method: 'GET'
        });

      expect(res.status).toBe(201);
      expect(res.body).toEqual(sampleMock);
      expect(mockManager.createMockRule).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Get Users Mock',
          urlPattern: '/api/v1/users'
        })
      );
    });

    it('should handle creation error', async () => {
      (mockManager.createMockRule as jest.Mock).mockImplementation(() => {
        throw new Error('Duplicate ID');
      });

      const res = await request(app)
        .post('/dashboard-api/mocks')
        .send({ urlPattern: '/api/test' });

      expect(res.status).toBe(500);
      expect(res.body.error).toContain('Duplicate ID');
    });
  });

  describe('PUT /dashboard-api/mocks/:id', () => {
    it('should update mock rule', async () => {
      const updated = { ...sampleMock, statusCode: 201 };
      (mockManager.updateMockRule as jest.Mock).mockReturnValue(updated);

      const res = await request(app)
        .put('/dashboard-api/mocks/mock-1')
        .send({ statusCode: 201 });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(updated);
    });

    it('should return 404 if rule to update is not found', async () => {
      (mockManager.updateMockRule as jest.Mock).mockReturnValue(null);

      const res = await request(app)
        .put('/dashboard-api/mocks/unknown-id')
        .send({ statusCode: 500 });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Mock rule not found');
    });
  });

  describe('DELETE /dashboard-api/mocks/:id', () => {
    it('should delete mock rule', async () => {
      (mockManager.deleteMockRule as jest.Mock).mockReturnValue(true);

      const res = await request(app).delete('/dashboard-api/mocks/mock-1');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should return 404 if rule to delete is not found', async () => {
      (mockManager.deleteMockRule as jest.Mock).mockReturnValue(false);

      const res = await request(app).delete('/dashboard-api/mocks/unknown-id');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Mock rule not found');
    });
  });

  describe('PATCH /dashboard-api/mocks/:id/toggle', () => {
    it('should toggle rule enabled state', async () => {
      const toggled = { ...sampleMock, enabled: false };
      (mockManager.toggleMockRule as jest.Mock).mockReturnValue(toggled);

      const res = await request(app).patch('/dashboard-api/mocks/mock-1/toggle');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(toggled);
    });

    it('should return 404 if rule to toggle is not found', async () => {
      (mockManager.toggleMockRule as jest.Mock).mockReturnValue(null);

      const res = await request(app).patch('/dashboard-api/mocks/unknown-id/toggle');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Mock rule not found');
    });
  });
});
