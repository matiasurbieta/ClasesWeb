import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function createOpenApiDocument(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('Todos API')
    .setDescription('CRUD API for the Todo entity, persisted in MongoDB')
    .setVersion('1.0')
    .build();
  return SwaggerModule.createDocument(app, config);
}
