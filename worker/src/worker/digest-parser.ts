export function extractAbstract(fullText: string): string | null {
    const text = fullText.replace(/\s+/g, ' ').trim();

    // House: "Abstract: <one-liner>" — stop at the first section marker.
    const absIdx = text.search(/\bAbstract\s*:/i);
    if (absIdx !== -1) {
        const after = text.slice(absIdx + 'Abstract:'.length).trimStart();
        const end = after.search(/\bPresent\s+law\b|\bProposed\s+law\b|\bThis\s+act\b|\bThis\s+bill\b/i);
        return (end === -1 ? after.slice(0, 500) : after.slice(0, end)).trim() || null;
    }

    // Senate: prose immediately follows "Session <Author> " — take up to first section marker.
    const sessionMatch = text.match(/(?:Regular|Special)\s+Session\s+\S+\s+/i);
    if (sessionMatch) {
        const after = text.slice(sessionMatch.index! + sessionMatch[0].length).trim();
        const end = after.search(/\bPresent\s+law\b|\bProposed\s+law\b|\((?:Amends|Adds|Repeals|Creates|Enacts)|\$\s*[\d,]/i);
        return (end === -1 ? after.slice(0, 500) : after.slice(0, end)).trim() || null;
    }

    return null;
}

