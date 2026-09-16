import { serve } from '@hono/node-server';
import { app, config } from './index';

serve({ fetch: app.fetch, port: config.port, hostname: '127.0.0.1' }, (info) => {
  console.log(`[circuit] listening on http://${info.address}:${info.port} (${process.env.NODE_ENV ?? 'development'})`);
});
