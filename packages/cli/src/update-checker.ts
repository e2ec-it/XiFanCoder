import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';

const PACKAGE_NAME = '@xifan-coder/cli';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 1 day
const REQUEST_TIMEOUT_MS = 3_000;
const CACHE_FILE = path.join(os.homedir(), '.xifan', 'coder', 'update-check.json');

interface CacheData {
  readonly lastCheck: number;
  readonly latestVersion: string;
}

export function readCache(): CacheData | undefined {
  try {
    if (!fs.existsSync(CACHE_FILE)) return undefined;
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) as CacheData;
    if (typeof raw.lastCheck === 'number' && typeof raw.latestVersion === 'string') {
      return raw;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function writeCache(data: CacheData): void {
  try {
    const dir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data), 'utf8');
  } catch {
    // Cache write failures are non-critical; the next check will re-fetch
  }
}

function fetchLatestVersion(): Promise<string | undefined> {
  return new Promise((resolve) => {
    const encodedName = PACKAGE_NAME.replaceAll('/', '%2F');
    const url = `https://registry.npmjs.org/${encodedName}/latest`;
    const req = https.get(url, { timeout: REQUEST_TIMEOUT_MS }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        resolve(undefined);
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        try {
          const pkg = JSON.parse(body) as { version?: string };
          resolve(pkg.version);
        } catch {
          resolve(undefined);
        }
      });
    });
    req.on('error', () => resolve(undefined));
    req.on('timeout', () => {
      req.destroy();
      resolve(undefined);
    });
  });
}

export function compareVersions(current: string, latest: string): number {
  const clean = (v: string): string => v.replace(/^v/, '');
  const a = clean(current);
  const b = clean(latest);

  const aParts = a.split('-');
  const bParts = b.split('-');
  const aBase = (aParts[0] ?? a).split('.').map((n) => parseInt(n, 10) || 0);
  const bBase = (bParts[0] ?? b).split('.').map((n) => parseInt(n, 10) || 0);

  for (let i = 0; i < 3; i++) {
    const diff = (bBase[i] ?? 0) - (aBase[i] ?? 0);
    if (diff !== 0) return diff;
  }

  const aPrerelease = aParts[1];
  const bPrerelease = bParts[1];

  // Same base version: stable > prerelease
  if (aPrerelease && !bPrerelease) return 1; // latest is stable, current is prerelease → update
  if (!aPrerelease && bPrerelease) return -1; // latest is prerelease, current is stable → no update

  return 0;
}

export async function checkForUpdates(currentVersion: string): Promise<string | undefined> {
  if (process.env.XIFAN_NO_UPDATE_CHECK === '1') return undefined;

  const cache = readCache();
  const now = Date.now();

  if (cache && now - cache.lastCheck < CHECK_INTERVAL_MS) {
    if (compareVersions(currentVersion, cache.latestVersion) > 0) {
      return cache.latestVersion;
    }
    return undefined;
  }

  const latest = await fetchLatestVersion();
  if (!latest) return undefined;

  writeCache({ lastCheck: now, latestVersion: latest });

  if (compareVersions(currentVersion, latest) > 0) {
    return latest;
  }
  return undefined;
}

export function formatUpdateMessage(currentVersion: string, latestVersion: string): string {
  return [
    '',
    `  Update available: v${currentVersion} -> v${latestVersion}`,
    `  Run "npm install -g ${PACKAGE_NAME}" or "pnpm add -g ${PACKAGE_NAME}" to update`,
    '',
  ].join('\n');
}
