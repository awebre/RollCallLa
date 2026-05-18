// Aspire TypeScript AppHost
// For more information, see: https://aspire.dev

import { createBuilder } from './.modules/aspire.js';

const builder = await createBuilder();

const worker = await builder
    .addExecutable('worker', 'npm', '../worker', ['run', 'dev', '--', '--host', '--strictPort'])
    .withHttpEndpoint({ targetPort: 5173, isProxied: false });

await builder
    .addDevTunnel('tunnel', { allowAnonymous: true })
    .withTunnelReferenceAll(worker, true);

await builder.build().run();
