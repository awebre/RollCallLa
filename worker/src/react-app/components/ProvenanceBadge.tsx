type Props = {
    source?: 'roster' | 'pdf' | null;
    term_source?: 'official' | 'wikipedia' | 'derived' | null;
    style?: React.CSSProperties;
};

// Inline pill rendered next to a legislator name. Communicates that we don't have
// official-chamber data for this person — only what we could reconstruct from the
// PDFs or from a third-party reference.
export function ProvenanceBadge({ source, term_source, style }: Props) {
    if (source === 'pdf') {
        return (
            <span
                title="Reconstructed from roll-call PDFs — no official chamber roster entry. Last name is all we have."
                style={{
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    color: '#8a4a00',
                    background: '#fdf3e0',
                    border: '1px solid #e8c98a',
                    padding: '0.05rem 0.35rem',
                    borderRadius: 3,
                    marginLeft: '0.4rem',
                    verticalAlign: 'middle',
                    ...style,
                }}
            >
                PDF-only
            </span>
        );
    }
    if (term_source === 'wikipedia' || term_source === 'derived') {
        const label = term_source === 'wikipedia' ? 'Term: Wikipedia' : 'Term: derived';
        const title = term_source === 'wikipedia'
            ? 'Term-start date was scraped from Wikipedia, not an official source.'
            : 'Term-end date was inferred from the successor’s sworn-in date.';
        return (
            <span
                title={title}
                style={{
                    fontSize: '0.7rem',
                    fontWeight: 500,
                    color: '#555',
                    background: '#f0f0f0',
                    border: '1px solid #ddd',
                    padding: '0.05rem 0.35rem',
                    borderRadius: 3,
                    marginLeft: '0.4rem',
                    verticalAlign: 'middle',
                    ...style,
                }}
            >
                {label}
            </span>
        );
    }
    return null;
}
