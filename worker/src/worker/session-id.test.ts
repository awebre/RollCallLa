import { describe, it, expect } from 'vitest';
import { parseSession, sessionIdFor, isSpecialSession } from './session-id';

describe('parseSession', () => {
    it.each([
        ['24RS',  { year: 2024, kind: 'RS', n: 0 }],
        ['26RS',  { year: 2026, kind: 'RS', n: 0 }],
        ['24OS',  { year: 2024, kind: 'OS', n: 0 }],
        ['241ES', { year: 2024, kind: 'ES', n: 1 }],
        ['242ES', { year: 2024, kind: 'ES', n: 2 }],
        ['243ES', { year: 2024, kind: 'ES', n: 3 }],
        ['251ES', { year: 2025, kind: 'ES', n: 1 }],
        ['21VS',  { year: 2021, kind: 'VS', n: 0 }],
        ['221VS', { year: 2022, kind: 'VS', n: 1 }],
    ])('parses %s', (input, expected) => {
        expect(parseSession(input)).toMatchObject(expected);
    });

    it('rejects unknown shapes', () => {
        expect(() => parseSession('foo')).toThrow();
        expect(() => parseSession('24XS')).toThrow();
        expect(() => parseSession('241RS')).toThrow(); // RS doesn't take a number
    });
});

describe('sessionIdFor', () => {
    it('keeps existing RS encoding stable so 24RS / 26RS rows in D1 are unaffected', () => {
        expect(sessionIdFor('24RS')).toBe(24001);
        expect(sessionIdFor('26RS')).toBe(26001);
    });

    it('gives each ES of a year a distinct id', () => {
        const ids = new Set([
            sessionIdFor('241ES'),
            sessionIdFor('242ES'),
            sessionIdFor('243ES'),
        ]);
        expect(ids.size).toBe(3);
    });

    it.each([
        ['241ES', 24011],
        ['242ES', 24012],
        ['243ES', 24013],
        ['251ES', 25011],
        ['24OS',  24002],
        ['221VS', 22021],
    ])('encodes %s -> %i', (input, expected) => {
        expect(sessionIdFor(input)).toBe(expected);
    });
});

describe('isSpecialSession', () => {
    it.each([
        ['24RS',  false],
        ['25RS',  false],
        ['241ES', true],
        ['24OS',  true],
        ['21VS',  true],
    ])('%s -> %s', (input, expected) => {
        expect(isSpecialSession(input)).toBe(expected);
    });
});
