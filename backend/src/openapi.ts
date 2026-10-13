// Writes the OpenAPI document to ./openapi.json. Needs MongoDB reachable (the app boots fully).
import { writeFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { createOpenApiDocument } from './swagger.js';

const app = await NestFactory.create(AppModule, { logger: false });
writeFileSync(
  'openapi.json',
  JSON.stringify(createOpenApiDocument(app), null, 2) + '\n',
);
await app.close();
console.log('openapi.json written');
