export function partyColorClass(party: string | null): string {
  if (party === "D") return "text-(--party-d)";
  if (party === "R") return "text-(--party-r)";
  if (party === "I") return "text-(--party-i)";
  return "text-(--party-none)";
}

export function resultColorClass(passed: boolean): string {
  return passed ? "text-(--app-pass)" : "text-(--app-fail)";
}

export function castVoteColorClass(castVote: number): string {
  if (castVote === 1) return "text-(--vote-yea)";
  if (castVote === 2) return "text-(--vote-nay)";
  if (castVote === 3) return "text-(--vote-nv)";
  return "text-(--vote-absent)";
}