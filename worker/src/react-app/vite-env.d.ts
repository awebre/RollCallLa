/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_GEO_BASE_URL?: string;
    readonly VITE_TURNSTILE_SITEKEY?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}

interface TurnstileWidget {
    render(container: HTMLElement, options: {
        sitekey: string;
        callback?: (token: string) => void;
        'expired-callback'?: () => void;
        'error-callback'?: () => void;
    }): string;
    remove(widgetId: string): void;
    reset(widgetId: string): void;
}

interface Window {
    turnstile?: TurnstileWidget;
}
