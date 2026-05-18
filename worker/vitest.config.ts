import { defineConfig } from 'vitest/config';

// Pure unit tests run in Node without the Cloudflare Workers runtime plugin.
// The default Vite config (vite.config.ts) wires @cloudflare/vite-plugin, which
// validates Worker-environment options at startup — those validations don't apply
// to a node test process and fail loudly. Override with a minimal config.
export default defineConfig({
    test: {
        include: ['src/**/*.test.ts'],
        environment: 'node',
    },
});
