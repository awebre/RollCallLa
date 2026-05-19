import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';

const GEO_R2_URL = 'https://pub-ba0e97deac4e4930beeb1245ba9bc941.r2.dev';

export default defineConfig(({ mode }) => {
    const useR2 = mode === 'production' || process.env.VITE_USE_R2 === 'true';
    return {
        plugins: [react(), cloudflare()],
        server: { allowedHosts: ['.devtunnels.ms'] },
        define: {
            // Public R2 URL — not a secret, safe to commit here.
            // Dev defaults to /geo (Worker route → local R2 emulation).
            // Override: VITE_USE_R2=true npm run dev
            'import.meta.env.VITE_GEO_BASE_URL': JSON.stringify(
                process.env.VITE_GEO_BASE_URL ?? (useR2 ? GEO_R2_URL : '/geo')
            ),
        },
    };
});
