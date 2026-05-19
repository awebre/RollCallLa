import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';

const GEO_R2_URL = 'https://pub-ba0e97deac4e4930beeb1245ba9bc941.r2.dev';

export default defineConfig(({ mode }) => ({
    plugins: [react(), cloudflare()],
    server: { allowedHosts: ['.devtunnels.ms'] },
    define: {
        // Public R2 URL — not a secret, safe to commit here.
        // Dev falls back to /geo (Worker route → local R2 emulation).
        'import.meta.env.VITE_GEO_BASE_URL': JSON.stringify(
            process.env.VITE_GEO_BASE_URL ?? (mode === 'production' ? GEO_R2_URL : '/geo')
        ),
    },
}));
