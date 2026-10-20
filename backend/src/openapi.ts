// Writes the OpenAPI document to ./openapi.json. Needs MongoDB reachable (the app boots fully).
import { writeFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { createOpenApiDocument } from './swagger.js';

// The JwtStrategy needs these to construct; no request is served here, so placeholders are fine.
process.env.OIDC_ISSUER ??= 'https://accounts.google.com';
process.env.OIDC_AUDIENCE ??= 'todos-api';
process.env.OIDC_JWKS_URI ??= 'https://www.googleapis.com/oauth2/v3/certs';

const app = await NestFactory.create(AppModule, { logger: false });
writeFileSync(
  'openapi.json',
  JSON.stringify(createOpenApiDocument(app), null, 2) + '\n',
);
await app.close();
console.log('openapi.json written');
