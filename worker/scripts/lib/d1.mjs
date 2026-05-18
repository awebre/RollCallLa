// Tiny wrapper around `wrangler d1 execute` so the three scrape scripts can read
// from either the local SQLite file or remote production D1, depending on where
// they're running. CI sets D1_TARGET=remote in the refresh-data workflow; locally
// it's omitted and defaults to --local.
//
// Usage:
//   import { runD1 } from './lib/d1.mjs';
//   const rows = runD1('SELECT ...', { cwd: '/path/to/worker' });

import { execFileSync } from 'node:child_process';

const TARGET = process.env.D1_TARGET ?? 'local';
if (TARGET !== 'local' && TARGET !== 'remote') {
    throw new Error(`D1_TARGET must be 'local' or 'remote' (got ${TARGET})`);
}

export function runD1(cmd, { cwd } = {}) {
    const out = execFileSync(
        'npx',
        ['wrangler', 'd1', 'execute', 'la_vote_tracker', `--${TARGET}`, '--command', cmd, '--json'],
        { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const jsonStart = out.indexOf('\n[');
    const json = JSON.parse(out.slice(jsonStart === -1 ? out.indexOf('[') : jsonStart + 1));
    return json[0]?.results ?? [];
}
