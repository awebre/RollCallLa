/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_GEO_BASE_URL?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}

interface Window {
    turnstile?: {
        render: (
            container: string | HTMLElement,
            params: {
                sitekey: string;
                callback?: (token: string) => void;
                'error-callback'?: () => void;
                'expired-callback'?: () => void;
            },
        ) => string;
        reset: (widgetId: string) => void;
        remove: (widgetId: string) => void;
    };
}
