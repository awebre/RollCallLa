const MODEL = '@cf/meta/llama-3.1-8b-instruct' as const;

const SYSTEM_PROMPT = `You summarize Louisiana legislative bill digests. \
Be concise and factual. Use plain language a general audience can follow. \
Do not repeat the abstract. Do not editorialize.`;

const USER_PROMPT = (abstract: string, digestText: string) =>
    `Abstract: ${abstract}

Digest:
${digestText}

In 2–4 sentences, describe what additional details this digest contains beyond the abstract — \
key provisions, mechanisms, conditions, effective dates, or anything that would help someone \
decide whether to read the full bill text.`;

const MAX_DIGEST_CHARS = 8_000;

export async function generateSummary(
    abstract: string | null,
    fullText: string,
    env: Env,
): Promise<string> {
    const truncated = fullText.slice(0, MAX_DIGEST_CHARS);

    const gatewayOpts = env.AI_GATEWAY_ID
        ? { gateway: { id: env.AI_GATEWAY_ID, skipCache: false, cacheTtl: 60 * 60 * 24 * 7 } }
        : {};

    const response = await env.AI.run(
        MODEL,
        {
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: USER_PROMPT(abstract ?? '', truncated) },
            ],
        },
        gatewayOpts,
    );

    const text = (response as { response?: string }).response?.trim();
    if (!text) throw new Error('Empty response from Workers AI');
    return text;
}
