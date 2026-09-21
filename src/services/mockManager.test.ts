import fs from 'fs';
import path from 'path';
import * as mockManager from './mockManager';
import * as settingsManager from './settingsManager';
import type { MockRule } from '../types';

jest.mock('fs');
jest.mock('./settingsManager');

describe('Mock Manager (src/services/mockManager.ts)', () => {
  const fakeConfigDir = '/mock/config';
  const fakeMocksFile = '/mock/config/mocks.json';
  let fileContent: string | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    mockManager.clearMockCache();
    fileContent = null;

    (settingsManager.getConfigDir as jest.Mock).mockReturnValue(fakeConfigDir);

    (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
      if (p === fakeConfigDir) return true;
      if (p === fakeMocksFile) return fileContent !== null;
      return false;
    });

    (fs.readFileSync as jest.Mock).mockImplementation((p: string) => {
      if (p === fakeMocksFile && fileContent !== null) return fileContent;
      throw new Error(`File not found: ${p}`);
    });

    (fs.writeFileSync as jest.Mock).mockImplementation((p: string, data: string) => {
      if (p === fakeMocksFile) fileContent = data;
    });
  });

  describe('Pattern Matching Helpers', () => {
    it('normalizeUrlPath should ensure leading slash and strip query string', () => {
      expect(mockManager.normalizeUrlPath('api/users?search=1')).toBe('/api/users');
      expect(mockManager.normalizeUrlPath('/api/checkout')).toBe('/api/checkout');
      expect(mockManager.normalizeUrlPath('')).toBe('/');
    });

    it('matchesUrlPattern with prefix match', () => {
      expect(mockManager.matchesUrlPattern('/api/v1/users/123', '/api/v1/users', 'prefix')).toBe(true);
      expect(mockManager.matchesUrlPattern('/other/endpoint', '/api/v1/users', 'prefix')).toBe(false);
    });

    it('matchesUrlPattern with exact match', () => {
      expect(mockManager.matchesUrlPattern('/api/auth/login', '/api/auth/login', 'exact')).toBe(true);
      expect(mockManager.matchesUrlPattern('/api/auth/login?redirect=1', '/api/auth/login', 'exact')).toBe(true);
      expect(mockManager.matchesUrlPattern('/api/auth/login/sub', '/api/auth/login', 'exact')).toBe(false);
    });

    it('matchesUrlPattern with glob patterns', () => {
      expect(mockManager.matchesUrlPattern('/api/users/42/details', '/api/users/*/details', 'glob')).toBe(true);
      expect(mockManager.matchesUrlPattern('/api/users/42/extra/details', '/api/users/*/details', 'glob')).toBe(false);
      expect(mockManager.matchesUrlPattern('/api/v1/orders/a/b/c', '/api/v1/**', 'glob')).toBe(true);
    });

    it('matchesUrlPattern with regex patterns', () => {
      expect(mockManager.matchesUrlPattern('/api/items/999', '^/api/items/\\d+$', 'regex')).toBe(true);
      expect(mockManager.matchesUrlPattern('/api/items/abc', '^/api/items/\\d+$', 'regex')).toBe(false);
    });
  });

  describe('CRUD operations & Caching', () => {
    it('should return empty list when mocks.json does not exist', () => {
      const rules = mockManager.getMockRules();
      expect(rules).toEqual([]);
    });

    it('should create and cache a new mock rule', () => {
      const rule = mockManager.createMockRule({
        name: 'Stripe Mock',
        appId: 'app-stripe',
        enabled: true,
        method: 'POST',
        urlPattern: '/v1/charges',
        matchType: 'prefix',
        responseType: 'mock',
        statusCode: 402,
        body: JSON.stringify({ error: 'Card declined' }),
        delayMs: 250
      });

      expect(rule.id).toBeDefined();
      expect(rule.statusCode).toBe(402);
      expect(rule.delayMs).toBe(250);
      expect(fileContent).not.toBeNull();

      // Read from cache
      (fs.readFileSync as jest.Mock).mockClear();
      const all = mockManager.getMockRules();
      expect(all.length).toBe(1);
      expect(fs.readFileSync).not.toHaveBeenCalled();
    });

    it('should update an existing mock rule', () => {
      const created = mockManager.createMockRule({
        name: 'Initial Rule',
        appId: '*',
        enabled: true,
        method: 'GET',
        urlPattern: '/test',
        matchType: 'exact',
        responseType: 'mock',
        statusCode: 200
      });

      const updated = mockManager.updateMockRule(created.id, {
        name: 'Updated Rule Name',
        statusCode: 500
      });

      expect(updated?.name).toBe('Updated Rule Name');
      expect(updated?.statusCode).toBe(500);
      expect(mockManager.getMockRuleById(created.id)?.statusCode).toBe(500);
    });

    it('should toggle and delete a mock rule', () => {
      const created = mockManager.createMockRule({
        name: 'To Toggle',
        appId: '*',
        enabled: true,
        method: 'GET',
        urlPattern: '/ping',
        matchType: 'exact',
        responseType: 'mock',
        statusCode: 200
      });

      const toggled = mockManager.toggleMockRule(created.id);
      expect(toggled?.enabled).toBe(false);

      const stats = mockManager.getMockStats();
      expect(stats.total).toBe(1);
      expect(stats.active).toBe(0);

      const deleted = mockManager.deleteMockRule(created.id);
      expect(deleted).toBe(true);
      expect(mockManager.getMockRules().length).toBe(0);
    });
  });

  describe('findMatchingMockRule', () => {
    it('should find matching enabled rule respecting method and appId scoping', () => {
      mockManager.createMockRule({
        name: 'App A Only',
        appId: 'app-a',
        enabled: true,
        method: 'POST',
        urlPattern: '/api/checkout',
        matchType: 'exact',
        responseType: 'mock',
        statusCode: 400
      });

      mockManager.createMockRule({
        name: 'Global GET Rule',
        appId: '*',
        enabled: true,
        method: 'GET',
        urlPattern: '/api/config',
        matchType: 'prefix',
        responseType: 'mock',
        statusCode: 200
      });

      // Match App A POST
      const match1 = mockManager.findMatchingMockRule({
        appId: 'app-a',
        method: 'POST',
        url: '/api/checkout'
      });
      expect(match1?.name).toBe('App A Only');

      // Do NOT match App B on App A specific rule
      const match2 = mockManager.findMatchingMockRule({
        appId: 'app-b',
        method: 'POST',
        url: '/api/checkout'
      });
      expect(match2).toBeNull();

      // Match Global Rule for any app
      const match3 = mockManager.findMatchingMockRule({
        appId: 'app-b',
        method: 'GET',
        url: '/api/config/v1'
      });
      expect(match3?.name).toBe('Global GET Rule');
    });

    it('should ignore disabled mock rules', () => {
      const rule = mockManager.createMockRule({
        name: 'Disabled Rule',
        appId: '*',
        enabled: false,
        method: 'GET',
        urlPattern: '/api/test',
        matchType: 'exact',
        responseType: 'mock',
        statusCode: 200
      });

      const match = mockManager.findMatchingMockRule({
        method: 'GET',
        url: '/api/test'
      });
      expect(match).toBeNull();
    });
  });
});
