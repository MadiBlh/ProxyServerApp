import fs from 'fs';
import * as configManager from './configManager';
import * as settingsManager from './settingsManager';
import type { Application } from '../types';

jest.mock('fs');
jest.mock('./settingsManager');

describe('Config Manager (src/services/configManager.ts)', () => {
  const fakeConfigFile = '/mock/path/applications.json';
  const fakeConfigDir = '/mock/path';

  let fileContent: string | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    fileContent = null;

    (settingsManager.getConfigDir as jest.Mock).mockReturnValue(fakeConfigDir);
    (settingsManager.getConfigFile as jest.Mock).mockReturnValue(fakeConfigFile);

    (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
      if (p === fakeConfigDir) return true;
      if (p === fakeConfigFile) return fileContent !== null;
      return false;
    });

    (fs.readFileSync as jest.Mock).mockImplementation((p: string) => {
      if (p === fakeConfigFile && fileContent !== null) return fileContent;
      throw new Error(`File not found: ${p}`);
    });

    (fs.writeFileSync as jest.Mock).mockImplementation((p: string, data: string) => {
      if (p === fakeConfigFile) fileContent = data;
    });
  });

  describe('normalizePathPrefix', () => {
    it('should return "/" for empty or undefined prefix', () => {
      expect(configManager.normalizePathPrefix(undefined)).toBe('/');
      expect(configManager.normalizePathPrefix('')).toBe('/');
    });

    it('should prepend leading slash and trim trailing slash', () => {
      expect(configManager.normalizePathPrefix('api/v1')).toBe('/api/v1');
      expect(configManager.normalizePathPrefix('/api/v1/')).toBe('/api/v1');
      expect(configManager.normalizePathPrefix('  api/todos/  ')).toBe('/api/todos');
      expect(configManager.normalizePathPrefix('/')).toBe('/');
    });
  });

  describe('normalizeTargetUrl', () => {
    it('should return empty string for undefined or empty url', () => {
      expect(configManager.normalizeTargetUrl(undefined)).toBe('');
      expect(configManager.normalizeTargetUrl('')).toBe('');
    });

    it('should lowercase and trim trailing slashes and spaces', () => {
      expect(configManager.normalizeTargetUrl('HTTPS://API.Example.COM/v1/// ')).toBe(
        'https://api.example.com/v1'
      );
    });
  });

  describe('assignRedirectPort', () => {
    it('should assign BASE_REDIRECT_PORT (4001) when no apps exist', () => {
      const port = configManager.assignRedirectPort(undefined, 'http://example.com', []);
      expect(port).toBe(4001);
    });

    it('should reuse port when another redirect targets the exact same URL', () => {
      const existingApps: Application[] = [
        {
          id: 'app-1',
          name: 'App 1',
          frontEndUrl: 'http://localhost:3000',
          backendUrls: [],
          redirectUrls: [
            { id: 'r1', name: 'R1', targetUrl: 'http://example.com/api', port: 4005 }
          ],
          isActive: true
        }
      ];

      const port = configManager.assignRedirectPort(
        undefined,
        'http://example.com/api/',
        existingApps
      );
      expect(port).toBe(4005);
    });

    it('should avoid collisions with existing ports used by other targets', () => {
      const existingApps: Application[] = [
        {
          id: 'app-1',
          name: 'App 1',
          frontEndUrl: 'http://localhost:3000',
          backendUrls: [],
          redirectUrls: [
            { id: 'r1', name: 'R1', targetUrl: 'http://target-a.com', port: 4001 },
            { id: 'r2', name: 'R2', targetUrl: 'http://target-b.com', port: 4002 }
          ],
          isActive: true
        }
      ];

      const port = configManager.assignRedirectPort(
        undefined,
        'http://target-c.com',
        existingApps
      );
      expect(port).toBe(4003);
    });

    it('should preserve valid existingPort if it does not collide', () => {
      const port = configManager.assignRedirectPort(4050, 'http://target-c.com', []);
      expect(port).toBe(4050);
    });

    it('should never assign main server port 4000', () => {
      const port = configManager.assignRedirectPort(4000, 'http://target.com', []);
      expect(port).not.toBe(4000);
      expect(port).toBe(4001);
    });
  });

  describe('getApplications and saveApplications', () => {
    it('should write and return DEFAULT_CONFIG if config file does not exist', () => {
      fileContent = null;
      const apps = configManager.getApplications();

      expect(apps.length).toBeGreaterThan(0);
      expect(fileContent).not.toBeNull();
      expect(JSON.parse(fileContent!)).toEqual(apps);
    });

    it('should read existing applications from disk', () => {
      const mockData: Application[] = [
        {
          id: 'app-test',
          name: 'Test App',
          frontEndUrl: 'http://localhost:5000',
          backendUrls: [],
          redirectUrls: [],
          isActive: true
        }
      ];
      fileContent = JSON.stringify(mockData);

      const apps = configManager.getApplications();
      expect(apps).toEqual(mockData);
    });

    it('should return empty array when JSON is malformed', () => {
      fileContent = '{ bad json';
      const apps = configManager.getApplications();
      expect(apps).toEqual([]);
    });

    it('should get application by id', () => {
      const mockData: Application[] = [
        {
          id: 'app-1',
          name: 'App 1',
          frontEndUrl: '',
          backendUrls: [],
          redirectUrls: [],
          isActive: true
        }
      ];
      fileContent = JSON.stringify(mockData);

      expect(configManager.getApplicationById('app-1')?.name).toBe('App 1');
      expect(configManager.getApplicationById('not-exist')).toBeUndefined();
    });
  });

  describe('createApplication, updateApplication, deleteApplication', () => {
    beforeEach(() => {
      fileContent = JSON.stringify([]);
    });

    it('should create an application with normalized pathPrefix and assigned redirect ports', () => {
      const created = configManager.createApplication({
        name: 'New Service',
        frontEndUrl: 'http://localhost:3000',
        backendUrls: [
          { name: 'Auth', url: 'http://auth.local', pathPrefix: 'api/auth/' }
        ],
        redirectUrls: [
          { name: 'Payment', targetUrl: 'http://pay.local' }
        ]
      });

      expect(created.id).toBeDefined();
      expect(created.name).toBe('New Service');
      expect(created.backendUrls[0]?.pathPrefix).toBe('/api/auth');
      expect(created.redirectUrls[0]?.port).toBe(4001);

      const all = configManager.getApplications();
      expect(all.length).toBe(1);
    });

    it('should update an existing application and preserve its id', () => {
      const created = configManager.createApplication({ name: 'Original Name' });
      const updated = configManager.updateApplication(created.id, {
        name: 'Updated Name',
        isActive: false
      });

      expect(updated).not.toBeNull();
      expect(updated?.id).toBe(created.id);
      expect(updated?.name).toBe('Updated Name');
      expect(updated?.isActive).toBe(false);
    });

    it('should return null when updating a non-existent application', () => {
      const updated = configManager.updateApplication('fake-id', { name: 'None' });
      expect(updated).toBeNull();
    });

    it('should delete an application and return true, or false if not found', () => {
      const created = configManager.createApplication({ name: 'To Delete' });
      expect(configManager.getApplications().length).toBe(1);

      const result = configManager.deleteApplication(created.id);
      expect(result).toBe(true);
      expect(configManager.getApplications().length).toBe(0);

      const notFoundResult = configManager.deleteApplication('non-existent');
      expect(notFoundResult).toBe(false);
    });
  });
});
