import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { createOpenApiDocument } from './swagger.js';

// Loads backend/.env (AUTH0_*, PORT, MONGO_URI) if present. No dependency needed on Node >= 20.12.
try {
  process.loadEnvFile();
} catch {
  // no .env: fall back to the variables already in the environment
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // Swagger UI at /api, raw OpenAPI JSON at /api-json
  SwaggerModule.setup('api', app, createOpenApiDocument(app));
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
