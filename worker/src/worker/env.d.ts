interface Env {
    TURNSTILE_SECRET: string;
    FEEDBACK_FROM_EMAIL: string;
    SEND_EMAIL?: SendEmail;
    SESSION_SECRET: string;
    RP_ID?: string;
}

interface SendEmail {
    send(message: unknown): Promise<void>;
}
