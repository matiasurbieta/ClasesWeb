// Writes the OpenAPI document to ./openapi.json. Needs MongoDB reachable (the app boots fully).
import { writeFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { createOpenApiDocument } from './swagger.js';

// The JwtStrategy needs these to construct; no request is served here, so placeholders are fine.
process.env.AUTH0_ISSUER ??= 'https://example.auth0.com/';
process.env.AUTH0_AUDIENCE ??= 'todos-api';

const app = await NestFactory.create(AppModule, { logger: false });
writeFileSync(
  'openapi.json',
  JSON.stringify(createOpenApiDocument(app), null, 2) + '\n',
);
await app.close();
console.log('openapi.json written');
