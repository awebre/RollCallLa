import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { extractAbstract } from './digest-parser';

const FIXTURES_DIR = join(fileURLToPath(new URL('.', import.meta.url)), 'digest-parser-fixtures');

interface Fixture {
    docsId: number;
    billNumber: string;
    version: string;
    abstract: string | null;
    fullText: string;
}

const fixtures: Fixture[] = readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(FIXTURES_DIR, f), 'utf8')) as Fixture);

describe('extractAbstract', () => {
    it.each(fixtures.map((f) => [f.billNumber, f.version, f] as const))(
        '%s — %s',
        (_, __, fixture) => {
            expect(extractAbstract(fixture.fullText)).toBe(fixture.abstract);
        },
    );
});
