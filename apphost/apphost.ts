// Aspire TypeScript AppHost
// For more information, see: https://aspire.dev

import { createBuilder } from './.modules/aspire.js';

const builder = await createBuilder();

const worker = await builder
    // CommunityToolkit.Aspire.Hosting.NodeJS.Extensions has no TS bindings yet;
    // addExecutable + sh is the current workaround for npm-based dev servers.
    .addExecutable('roll-call-la', 'sh', '../worker', ['-c', 'npm install && npm run setup:local:geo && npm run dev -- --host --strictPort'])
    .withHttpEndpoint({ targetPort: 5173, isProxied: false });

await builder
    .addDevTunnel('tunnel', { allowAnonymous: true })
    .withTunnelReferenceAll(worker, true);

await builder.build().run();
