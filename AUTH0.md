# Auth0 login in the frontend and the backend

*Versión en español: [AUTH0.es.md](AUTH0.es.md)*

> **Status:** applied in this branch. `OAUTH.md` (branch `full-api`) explains the concepts: roles, the
> Authorization Code + PKCE flow, Auth.js on the frontend, Passport JWT on the backend. This document is
> the Auth0-specific setup, what differs from that guide, and what changed in the code.

## 1. What differs from `OAUTH.md`

| Topic | `OAUTH.md` (Google) | This branch (Auth0) |
|---|---|---|
| Auth.js provider | `Google`, env `AUTH_GOOGLE_*` | `Auth0`, env `AUTH_AUTH0_ID`, `AUTH_AUTH0_SECRET`, `AUTH_AUTH0_ISSUER` |
| Token sent to the API | the **ID token** (Google's access tokens are opaque) | the **access token**, requested for our API's `audience` |
| Backend variables | `OIDC_ISSUER`, `OIDC_AUDIENCE`, `OIDC_JWKS_URI` | `AUTH0_ISSUER`, `AUTH0_AUDIENCE` (the JWKS URL is always `<issuer>.well-known/jwks.json`) |

Why the access token: Auth0 issues a verifiable JWT access token only when the login request names an
`audience`, the identifier of an **API registered in the tenant**. That token carries `aud = <identifier>`
and `sub = <user id>`, which is exactly what a resource server should check. ID tokens are meant for the
client app, and Auth0 rejects them as API credentials by design. The backend code is the same Passport
strategy as in `OAUTH.md`; only the claims it expects come from a different token.

## 2. Auth0 dashboard setup

1. Create a free tenant at <https://auth0.com>. Note the **Domain** (e.g. `acme.us.auth0.com`).
2. **Applications → Create Application** → name `Todos frontend`, type **Regular Web Applications**.
   In *Settings* fill in and save:
   - Allowed Callback URLs: `http://localhost:3000/api/auth/callback/auth0`
   - Allowed Logout URLs: `http://localhost:3000`
   - Allowed Web Origins: `http://localhost:3000`

   Copy **Client ID** and **Client Secret**.
3. **Applications → APIs → Create API** → name `Todos API`, identifier `http://localhost:3001`
   (any URI works; it is an identifier, Auth0 never calls it), signing algorithm **RS256**.
   The identifier is the `audience` both apps use.
4. A user to sign in with: the tenant ships with a database connection, so **Sign up** on the login
   page works, or create one under **User Management → Users**. Google social login is enabled by
   default with Auth0's development keys.

## 3. Configure and run

```bash
# backend/.env (gitignored)
cp backend/.env.example backend/.env          # AUTH0_ISSUER=https://<domain>/  AUTH0_AUDIENCE=http://localhost:3001

# frontend/.env.local (gitignored)
cp frontend/.env.example frontend/.env.local  # AUTH_AUTH0_ID, AUTH_AUTH0_SECRET, AUTH_AUTH0_ISSUER=https://<domain>, AUTH0_AUDIENCE
cd frontend && npx auth secret                # appends AUTH_SECRET
```

`AUTH0_ISSUER` in the backend must match the token's `iss` claim exactly, and Auth0 writes it **with a
trailing slash**: `https://acme.us.auth0.com/`. Auth.js accepts the frontend issuer with or without it.

```bash
cd backend && docker compose up -d && npm run start:dev   # reads .env, API on :3001
cd frontend && npm run dev                                # http://localhost:3000
```

## 4. What changed in the code

Frontend (`frontend/`):

| File | Change |
|---|---|
| `src/auth.ts` | Auth.js config: `Auth0` provider with `authorization.params.audience`; `jwt`/`session` callbacks copy `account.access_token` to `session.accessToken`. |
| `src/app/api/auth/[...nextauth]/route.ts` | Mounts sign-in, callback, sign-out and session under `/api/auth/*`. |
| `src/app/layout.tsx` | Wraps the app in `SessionProvider`. |
| `src/app/page.tsx` | `useSession()`: sign-in screen when anonymous, email + **Sign out** when signed in, todos loaded only once authenticated. |
| `src/lib/api.ts` | `openapi-fetch` middleware adds `Authorization: Bearer <accessToken>` to every call. |
| `src/lib/api-types.ts` | Regenerated: `owner` on `Todo`, `bearer` security scheme. |
| `.env.example` | Variables to copy into `.env.local`. |

Backend (`backend/`):

| File | Change |
|---|---|
| `src/auth/jwt.strategy.ts` | Verifies RS256 tokens against the tenant JWKS, checks `iss`/`aud`/`exp`, puts `{ id: sub, email }` on `req.user`. Fails at startup if the two variables are missing. |
| `src/auth/jwt-auth.guard.ts`, `public.decorator.ts`, `auth.module.ts` | Global guard (`APP_GUARD`); routes marked `@Public()` skip it. `GET /` is public as a health check. |
| `src/auth/current-user.decorator.ts` | `@CurrentUser()` parameter decorator. |
| `src/auth/jwt-auth.guard.spec.ts` | Test with a local JWKS server: public route, missing token, valid token, wrong audience/issuer, wrong key. `npm test` needs no tenant. |
| `src/todos/todo.schema.ts` | `owner` (the `sub` claim), required and indexed. |
| `src/todos/todos.service.ts`, `todos.controller.ts` | Every query is scoped by owner; another user's id answers `404`. `owner` is not in the DTOs and the `ValidationPipe` whitelists, so a client cannot set it. |
| `src/swagger.ts` | `addBearerAuth()`; `@ApiBearerAuth()` on `TodosController`. |
| `src/main.ts` | `process.loadEnvFile()` reads `.env` when present (no dependency, Node ≥ 20.12). |
| `src/openapi.ts` | Placeholder `AUTH0_*` values so `npm run openapi` works without a tenant. |
| `openapi.json` | Regenerated. |

## 5. Try it

- `curl -i localhost:3001/todos` → `401`. `curl localhost:3001/` → `200` (public).
- Open <http://localhost:3000>, **Sign in with Auth0**, sign up or log in, create a todo.
- In the browser console: `await fetch('/api/auth/session').then(r => r.json())` shows `accessToken`.
  Paste it in Swagger UI (<http://localhost:3001/api> → **Authorize**) and `GET /todos` returns your todos.
- Sign in with a second user: the list is empty, and `PATCH /todos/<first user's id>` answers `404`.

## 6. Gotchas

- **Sign out is local.** `signOut()` clears the Auth.js cookie; the Auth0 session cookie stays, so the next
  **Sign in** logs the same user in silently. To switch users during a demo, add `prompt: "login"` to
  `authorization.params` in `src/auth.ts`, or after signing out redirect the browser to
  `https://<domain>/v2/logout?client_id=<client id>&returnTo=http://localhost:3000`.
- **Token lifetime.** Access tokens last 24 h by default (API → Settings → Token Expiration). Nothing here
  refreshes them: when calls start answering `401`, sign in again. Real refresh needs the `offline_access`
  scope plus refresh-token rotation in the `jwt` callback (Auth.js guide "Refresh token rotation").
- **`getSession()` on every call.** The API middleware asks `/api/auth/session` before each request. Fine for
  a class; cache the token in memory if it ever matters.
- **Issuer slash.** A `401` on every request with a valid-looking token is almost always `AUTH0_ISSUER`
  without the trailing slash.
