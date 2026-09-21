import '../utils/bootstrap';
import fs from 'fs';
import path from 'path';
import * as settingsManager from './settingsManager';
import uuidv4 from '../utils/uuid';
import type { MockRule, CreateMockRuleInput, UpdateMockRuleInput, MockStats, MockMatchType } from '../types';

/* ==========================================================================
   MOCK MANAGER
   Manages mock rules & interception definitions saved in mocks.json.
   Provides high-performance in-memory caching and request pattern matching.
   ========================================================================== */

let cachedMockRules: MockRule[] | null = null;

/** Returns the path to the mocks.json configuration file. */
export function getMocksFile(): string {
  return path.join(settingsManager.getConfigDir(), 'mocks.json');
}

/** Clears in-memory mock rules cache. */
export function clearMockCache(): void {
  cachedMockRules = null;
}

/** Normalizes a URL path for matching (ensures leading slash, trims whitespace). */
export function normalizeUrlPath(urlPath: string): string {
  if (!urlPath) return '/';
  const clean = urlPath.trim();
  // Strip query string for path comparison if present
  const pathOnly = clean.split('?')[0] || '/';
  return pathOnly.startsWith('/') ? pathOnly : `/${pathOnly}`;
}

// Converts a glob pattern like "/api/*/checkout" or "/api/**" to a RegExp.
export function globToRegex(glob: string): RegExp {
  const clean = glob.trim().split('?')[0] || '/';
  const normalized = clean.startsWith('/') ? clean : `/${clean}`;
  const tokenized = normalized
    .replace(/\*\*/g, '___DOUBLE_STAR___')
    .replace(/\*/g, '___SINGLE_STAR___');
  const escaped = tokenized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regexString = '^' + escaped
    .replace(/___DOUBLE_STAR___/g, '.*')
    .replace(/___SINGLE_STAR___/g, '[^/]*') + '$';
  return new RegExp(regexString, 'i');
}

/** Tests if a request URL matches a rule's URL pattern according to its matchType. */
export function matchesUrlPattern(urlPath: string, pattern: string, matchType: MockMatchType = 'prefix'): boolean {
  if (!pattern) return false;
  const normalizedUrl = normalizeUrlPath(urlPath);
  const normalizedPattern = normalizeUrlPath(pattern);

  switch (matchType) {
    case 'exact':
      return normalizedUrl.toLowerCase() === normalizedPattern.toLowerCase();
    case 'prefix':
      return normalizedUrl.toLowerCase().startsWith(normalizedPattern.toLowerCase());
    case 'glob': {
      try {
        const regex = globToRegex(pattern);
        return regex.test(normalizedUrl);
      } catch {
        return false;
      }
    }
    case 'regex': {
      try {
        const regex = new RegExp(pattern.trim(), 'i');
        return regex.test(urlPath) || regex.test(normalizedUrl);
      } catch {
        return false;
      }
    }
    default:
      return normalizedUrl.toLowerCase().startsWith(normalizedPattern.toLowerCase());
  }
}

/** Reads mock rules from disk or cache. */
export function getMockRules(appId?: string): MockRule[] {
  if (cachedMockRules !== null) {
    if (appId && appId !== '*') {
      return cachedMockRules.filter(r => r.appId === '*' || r.appId === appId);
    }
    return cachedMockRules;
  }

  const mocksFile = getMocksFile();
  if (fs.existsSync(mocksFile)) {
    try {
      const data = fs.readFileSync(mocksFile, 'utf8');
      cachedMockRules = JSON.parse(data) as MockRule[];
    } catch (err) {
      console.error('[MockManager] Error reading mocks.json:', (err as Error).message);
      cachedMockRules = [];
    }
  } else {
    cachedMockRules = [];
  }

  if (appId && appId !== '*') {
    return (cachedMockRules || []).filter(r => r.appId === '*' || r.appId === appId);
  }
  return cachedMockRules || [];
}

/** Saves mock rules to disk and updates cache. */
export function saveMockRules(rules: MockRule[]): void {
  const mocksFile = getMocksFile();
  const dir = path.dirname(mocksFile);
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(mocksFile, JSON.stringify(rules, null, 2), 'utf8');
    cachedMockRules = rules;
  } catch (err) {
    console.error('[MockManager] Error writing mocks.json:', (err as Error).message);
    throw err;
  }
}

/** Retrieves a single mock rule by ID. */
export function getMockRuleById(id: string): MockRule | undefined {
  const rules = getMockRules();
  return rules.find(r => r.id === id);
}

/** Creates a new mock rule. */
export function createMockRule(input: CreateMockRuleInput): MockRule {
  const rules = [...getMockRules()];
  const now = new Date().toISOString();

  const newRule: MockRule = {
    id: input.id || uuidv4(),
    name: input.name?.trim() || 'Untitled Mock Rule',
    appId: input.appId?.trim() || '*',
    enabled: input.enabled !== undefined ? Boolean(input.enabled) : true,
    method: input.method?.toUpperCase().trim() || '*',
    urlPattern: input.urlPattern?.trim() || '/',
    matchType: input.matchType || 'prefix',
    responseType: input.responseType || 'mock',
    statusCode: typeof input.statusCode === 'number' ? input.statusCode : 200,
    statusText: input.statusText?.trim() || undefined,
    headers: input.headers || { 'content-type': 'application/json' },
    body: input.body !== undefined ? input.body : '{\n  "message": "Mock response"\n}',
    contentType: input.contentType || 'application/json',
    delayMs: typeof input.delayMs === 'number' ? Math.max(0, Math.min(input.delayMs, 10000)) : 0,
    createdAt: now,
    updatedAt: now
  };

  rules.unshift(newRule);
  saveMockRules(rules);
  return newRule;
}

/** Updates an existing mock rule. */
export function updateMockRule(id: string, input: UpdateMockRuleInput): MockRule | null {
  const rules = [...getMockRules()];
  const index = rules.findIndex(r => r.id === id);
  if (index === -1) return null;

  const existing = rules[index]!;
  const updatedRule: MockRule = {
    ...existing,
    ...input,
    id,
    method: input.method !== undefined ? input.method.toUpperCase().trim() : existing.method,
    statusCode: typeof input.statusCode === 'number' ? input.statusCode : existing.statusCode,
    delayMs: typeof input.delayMs === 'number' ? Math.max(0, Math.min(input.delayMs, 10000)) : existing.delayMs,
    updatedAt: new Date().toISOString()
  };

  rules[index] = updatedRule;
  saveMockRules(rules);
  return updatedRule;
}

/** Deletes a mock rule by ID. */
export function deleteMockRule(id: string): boolean {
  const rules = getMockRules();
  const filtered = rules.filter(r => r.id !== id);
  if (filtered.length === rules.length) return false;

  saveMockRules(filtered);
  return true;
}

/** Toggles a mock rule's enabled state. */
export function toggleMockRule(id: string, enabled?: boolean): MockRule | null {
  const rule = getMockRuleById(id);
  if (!rule) return null;

  const nextState = enabled !== undefined ? enabled : !rule.enabled;
  return updateMockRule(id, { enabled: nextState });
}

/** Returns statistics about mock rules (total & active counts). */
export function getMockStats(): MockStats {
  const rules = getMockRules();
  const active = rules.filter(r => r.enabled).length;
  return {
    total: rules.length,
    active,
    inactive: rules.length - active
  };
}

/**
 * Finds the first enabled mock rule matching the incoming request criteria.
 */
export function findMatchingMockRule(req: {
  appId?: string;
  method?: string;
  url: string;
  targetUrl?: string;
}): MockRule | null {
  const rules = getMockRules();
  const enabledRules = rules.filter(r => r.enabled);
  if (enabledRules.length === 0) return null;

  const reqMethod = (req.method || 'GET').toUpperCase();
  const reqUrl = req.url || '/';

  for (const rule of enabledRules) {
    // 1. Check Application Scope
    if (rule.appId !== '*' && req.appId && rule.appId !== req.appId) {
      continue;
    }

    // 2. Check HTTP Method
    if (rule.method !== '*' && rule.method.toUpperCase() !== reqMethod) {
      continue;
    }

    // 3. Check URL pattern
    if (matchesUrlPattern(reqUrl, rule.urlPattern, rule.matchType)) {
      return rule;
    }

    // Also check against full targetUrl if provided (for redirect proxies)
    if (req.targetUrl && matchesUrlPattern(req.targetUrl, rule.urlPattern, rule.matchType)) {
      return rule;
    }
  }

  return null;
}
