import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { createOpenApiDocument } from './swagger.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // Swagger UI at /api, raw OpenAPI JSON at /api-json
  SwaggerModule.setup('api', app, createOpenApiDocument(app));
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
