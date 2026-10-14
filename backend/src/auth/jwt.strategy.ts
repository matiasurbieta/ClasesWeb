import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import jwksRsa from 'jwks-rsa';
import { ExtractJwt, Strategy } from 'passport-jwt';

export type AuthUser = { id: string; email?: string };

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    // AUTH0_ISSUER is the tenant URL with a trailing slash, e.g. https://acme.us.auth0.com/
    // AUTH0_AUDIENCE is the identifier of the API registered in Auth0.
    const issuer = process.env.AUTH0_ISSUER;
    const audience = process.env.AUTH0_AUDIENCE;
    if (!issuer || !audience) {
      throw new Error('Set AUTH0_ISSUER and AUTH0_AUDIENCE (see AUTH0.md)');
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      algorithms: ['RS256'],
      issuer,
      audience,
      // Fetches the tenant's public keys once (cached) and picks the one matching the token's `kid`.
      secretOrKeyProvider: jwksRsa.passportJwtSecret({
        jwksUri: new URL('.well-known/jwks.json', issuer).href,
        cache: true,
        rateLimit: true,
      }),
    });
  }

  // Called only after signature, issuer, audience and expiry checked out. The return value becomes req.user.
  validate(payload: { sub: string; email?: string }): AuthUser {
    return { id: payload.sub, email: payload.email };
  }
}
