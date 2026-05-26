const MODEL = '@cf/meta/llama-3.1-8b-instruct' as const;

const SYSTEM_PROMPT = `You summarize Louisiana legislative bill digests. \
Be concise and factual. Use plain language a general audience can follow. \
Do not repeat the abstract. Do not editorialize. \
Do not open with meta-framing like "This digest..." or "The digest provides..." — start directly with substance. \
Do not list statute citation numbers (R.S. sections). \
Do not end with generic wrap-up sentences. \
Only mention an effective date if one is explicitly stated in the digest — do not infer or imply one.`;

const USER_PROMPT = (abstract: string, digestText: string) =>
    `Abstract: ${abstract}

Digest:
${digestText}

In 2–4 sentences, describe the key provisions, mechanisms, conditions, and effective dates \
that go beyond the abstract. Focus on specifics a reader would need to decide whether to read \
the full bill text. Skip statute numbers and meta-commentary about the digest itself.`;

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
