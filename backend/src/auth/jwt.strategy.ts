import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import jwksRsa from 'jwks-rsa';
import { ExtractJwt, Strategy } from 'passport-jwt';

export type AuthUser = { id: string; email?: string };

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    // Google: OIDC_ISSUER=https://accounts.google.com, OIDC_AUDIENCE=<client id>,
    // OIDC_JWKS_URI=https://www.googleapis.com/oauth2/v3/certs (see OAUTH.md, step 4.1).
    const { OIDC_ISSUER, OIDC_AUDIENCE, OIDC_JWKS_URI } = process.env;
    if (!OIDC_ISSUER || !OIDC_AUDIENCE || !OIDC_JWKS_URI) {
      throw new Error(
        'Set OIDC_ISSUER, OIDC_AUDIENCE and OIDC_JWKS_URI (see OAUTH.md)',
      );
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      algorithms: ['RS256'],
      issuer: OIDC_ISSUER,
      audience: OIDC_AUDIENCE,
      // Fetches the provider's public keys once (cached) and picks the one matching the token's `kid`.
      secretOrKeyProvider: jwksRsa.passportJwtSecret({
        jwksUri: OIDC_JWKS_URI,
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
