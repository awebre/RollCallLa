interface Env {
    la_vote_tracker: D1Database;
    GEO_ASSETS: R2Bucket;
    TURNSTILE_SECRET: string;
    FEEDBACK_FROM_EMAIL: string;
    SEND_EMAIL?: SendEmail;
    SESSION_SECRET: string;
    RP_ID?: string;
    AI: Ai;
    AI_GATEWAY_ID?: string;
}

interface SendEmail {
    send(message: unknown): Promise<void>;
}
