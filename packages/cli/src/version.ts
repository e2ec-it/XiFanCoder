import fs from 'node:fs';
import path from 'node:path';

let cachedVersion: string | undefined;

/**
 * Resolve the CLI version. Priority:
 * 1. Environment variable (XIFAN_APP_VERSION or npm_package_version)
 * 2. Walk up from this file to find @xifan-coder/cli package.json
 * 3. Fallback to 'unknown'
 */
export function resolveCliVersion(): string {
  if (cachedVersion !== undefined) return cachedVersion;

  const byEnv = process.env.XIFAN_APP_VERSION ?? process.env.npm_package_version;
  if (byEnv && byEnv.trim().length > 0) {
    cachedVersion = byEnv.trim();
    return cachedVersion;
  }

  const startDir =
    typeof __dirname === 'string' ? __dirname : path.dirname(new URL(import.meta.url).pathname);
  let dir = startDir;
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, 'package.json');
    if (fs.existsSync(candidate)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(candidate, 'utf8')) as {
          name?: string;
          version?: string;
        };
        if (pkg.name === '@xifan-coder/cli' && pkg.version) {
          cachedVersion = pkg.version;
          return cachedVersion;
        }
      } catch {
        // ignore parse errors
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  cachedVersion = 'unknown';
  return cachedVersion;
}
