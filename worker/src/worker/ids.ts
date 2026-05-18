// Synthetic legislator IDs are minted by the PDF parser when a name in a roll
// call doesn't match any current chamber roster member. Keep the range here so
// the parser and API agree on what "synthetic" means.
export const SYNTHETIC_MIN = 900_000;
export const SYNTHETIC_MAX = 999_999;
export function isSynthetic(peopleId: number): boolean {
    return peopleId >= SYNTHETIC_MIN && peopleId <= SYNTHETIC_MAX;
}
