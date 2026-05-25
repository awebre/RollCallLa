export type DigestChunk = {
    label: 'Present law' | 'Proposed law' | null;
    text: string;
};

export type ParsedDigest = {
    chunks: DigestChunk[];
    citations: string | null;
};

export function parseDigestSections(fullText: string): ParsedDigest {
    const text = fullText.replace(/\s+/g, ' ').trim();

    let body = stripHeader(text);

    // Extract trailing statute citations: (Amends/Adds/Repeals/Creates/Enacts…)
    const citIdx = body.search(/\s*\((?:Amends|Adds|Repeals|Creates|Enacts|Re-creates)/i);
    const citations = citIdx !== -1 ? body.slice(citIdx).trim() : null;
    if (citIdx !== -1) body = body.slice(0, citIdx).trim();

    const chunks = splitChunks(body);
    return { chunks, citations };
}

function stripHeader(text: string): string {
    // House bills have an explicit "Abstract: <one-liner>" — body starts at
    // the first Present law / Proposed law after it.
    const absIdx = text.search(/\bAbstract\s*:/i);
    if (absIdx !== -1) {
        const afterAbs = text.slice(absIdx + 'Abstract:'.length).trimStart();
        const firstSection = afterAbs.search(/\bPresent\s+law\b|\bProposed\s+law\b/);
        return firstSection === -1 ? afterAbs : afterAbs.slice(firstSection);
    }

    // Senate / conference reports: strip through "Session <Author> ".
    // Everything after the author name is the digest body.
    const sessionMatch = text.match(/(?:Regular|Special)\s+Session\s+\S+\s+/i);
    if (sessionMatch) {
        return text.slice(sessionMatch.index! + sessionMatch[0].length).trim();
    }

    return text;
}

function splitChunks(body: string): DigestChunk[] {
    if (!body) return [];

    // Case-sensitive: section headers are "Present law" / "Proposed law" (capital P/P)
    // in the PDFs. Lowercase "proposed law" / "present law" appear inline in sentences
    // and should not be treated as section boundaries.
    const markerRe = /\b(Present\s+law|Proposed\s+law)\b/g;
    const markers: Array<{ label: 'Present law' | 'Proposed law'; idx: number; end: number }> = [];
    let m;
    while ((m = markerRe.exec(body)) !== null) {
        markers.push({
            label: /present/i.test(m[1]) ? 'Present law' : 'Proposed law',
            idx: m.index,
            end: m.index + m[0].length,
        });
    }

    if (markers.length === 0) {
        return body.trim() ? [{ label: null, text: body.trim() }] : [];
    }

    const chunks: DigestChunk[] = [];

    // Any text before the first marker (conference report preamble, etc.)
    const intro = body.slice(0, markers[0].idx).trim();
    if (intro) chunks.push({ label: null, text: intro });

    for (let i = 0; i < markers.length; i++) {
        const end = i + 1 < markers.length ? markers[i + 1].idx : body.length;
        const t = body.slice(markers[i].end, end).trim();
        if (t) chunks.push({ label: markers[i].label, text: t });
    }

    return chunks;
}
