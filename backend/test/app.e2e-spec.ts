import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';

// The JwtStrategy needs these to construct; this test only calls the public GET /, so placeholders are fine.
process.env.OIDC_ISSUER ??= 'https://accounts.google.com';
process.env.OIDC_AUDIENCE ??= 'todos-api';
process.env.OIDC_JWKS_URI ??= 'https://www.googleapis.com/oauth2/v3/certs';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  afterEach(async () => {
    await app.close();
  });
});
