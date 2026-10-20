import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createSign, generateKeyPairSync, KeyObject } from 'node:crypto';
import { createServer, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { AuthModule } from './auth.module.js';
import { CurrentUser } from './current-user.decorator.js';
import type { AuthUser } from './jwt.strategy.js';
import { Public } from './public.decorator.js';

@Controller()
class TestController {
  @Public()
  @Get('open')
  open() {
    return 'open';
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return user;
  }
}

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
function sign(key: KeyObject, payload: object) {
  const data = `${b64({ alg: 'RS256', typ: 'JWT', kid: 'test' })}.${b64(payload)}`;
  const sig = createSign('RSA-SHA256')
    .update(data)
    .sign(key)
    .toString('base64url');
  return `${data}.${sig}`;
}

// Stands in for the identity provider: serves a JWKS with one key and signs tokens with it.
describe('JwtAuthGuard', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const audience = 'todos-api';
  let jwks: Server;
  let issuer: string;
  let app: INestApplication;

  beforeAll(async () => {
    const jwk = publicKey.export({ format: 'jwk' });
    jwks = createServer((_req, res) =>
      res.end(
        JSON.stringify({
          keys: [{ ...jwk, kid: 'test', use: 'sig', alg: 'RS256' }],
        }),
      ),
    );
    await new Promise<void>((resolve) => jwks.listen(0, resolve));
    issuer = `http://localhost:${(jwks.address() as AddressInfo).port}/`;
    process.env.OIDC_ISSUER = issuer;
    process.env.OIDC_JWKS_URI = issuer; // the stub answers the JWKS on any path
    process.env.OIDC_AUDIENCE = audience;
    const mod = await Test.createTestingModule({
      imports: [AuthModule],
      controllers: [TestController],
    }).compile();
    app = await mod.createNestApplication().init();
  });

  afterAll(async () => {
    await app.close();
    jwks.close();
  });

  const claims = (extra: object = {}) => ({
    iss: issuer,
    aud: audience,
    sub: 'google-123',
    email: 'ana@example.com',
    exp: Math.floor(Date.now() / 1000) + 60,
    ...extra,
  });
  const get = (path: string, token?: string) =>
    request(app.getHttpServer())
      .get(path)
      .set(token ? { Authorization: `Bearer ${token}` } : {});

  it('lets @Public routes through without a token', async () => {
    await get('/open').expect(200);
  });

  it('rejects a missing token', async () => {
    await get('/me').expect(401);
  });

  it('accepts a token signed by the tenant key and exposes the user', async () => {
    const { body } = await get('/me', sign(privateKey, claims())).expect(200);
    expect(body).toEqual({ id: 'google-123', email: 'ana@example.com' });
  });

  it('rejects a token for another audience or issuer', async () => {
    await get('/me', sign(privateKey, claims({ aud: 'other-api' }))).expect(
      401,
    );
    await get(
      '/me',
      sign(privateKey, claims({ iss: 'https://evil.example/' })),
    ).expect(401);
  });

  it('rejects a token signed by another key', async () => {
    const other = generateKeyPairSync('rsa', {
      modulusLength: 2048,
    }).privateKey;
    await get('/me', sign(other, claims())).expect(401);
  });
});
