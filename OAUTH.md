# Enabling OAuth 2.0 / OpenID Connect login in the frontend and the backend

*Versión en español: [OAUTH.es.md](OAUTH.es.md)*

> **Status:** how-to, not applied to the code. Nothing in this branch requires a login yet. The snippets
> are the starting point for the exercise; follow them in order and the result is a Todo app where each
> user signs in with Google (or any OpenID Connect provider) and only sees their own todos.

## 1. What we are adding and how it works

Today anyone can call `POST /todos`. The goal: users sign in with an identity provider, the Next.js app
receives a token, sends it on every API call, and the Nest API accepts only valid tokens and scopes todos
to the signed-in user.

OAuth 2.0 / OIDC vocabulary mapped to this project:

| Role | In this project |
|---|---|
| Resource owner | the person using the app |
| Client | the Next.js app (`frontend/`) |
| Authorization server / identity provider (IdP) | Google in this guide. Keycloak, Auth0, Microsoft Entra or any OpenID Connect provider works the same way. |
| Resource server | the Nest API (`backend/`) |

We never handle passwords. The flow is **Authorization Code with PKCE**, implemented by
[Auth.js](https://authjs.dev) (the library formerly called NextAuth) on the frontend:

1. The user clicks **Sign in**. Auth.js redirects the browser to Google with a one-time `code_challenge`.
2. Google authenticates the user and redirects back to `http://localhost:3000/api/auth/callback/google?code=...`.
3. Auth.js, on the server, exchanges the code for tokens: an `id_token` (a signed JWT with `sub`, `email`,
   `name`) and an `access_token`.
4. Auth.js stores the session in an encrypted cookie. We copy the `id_token` into that session.
5. Every API call from the frontend adds `Authorization: Bearer <id_token>`.
6. The API verifies the token offline: signature against Google's published public keys (JWKS), `iss`,
   `aud` and `exp`. The `sub` claim is the stable user id.

Which token to send: Google's access tokens are opaque strings that only Google can check, so for our own
first-party API we send the **ID token**, which is a JWT we can verify ourselves. With Keycloak or Auth0
you would instead request an **access token** issued for your API's audience; the backend code below does
not change, only the three environment variables do.

## 2. Register the app with the provider

### Google

1. [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → Credentials → Create
   credentials → OAuth client ID → Application type: Web application.
2. Authorized JavaScript origins: `http://localhost:3000`.
3. Authorized redirect URIs: `http://localhost:3000/api/auth/callback/google`.
4. Copy the **Client ID** and **Client secret**. The client ID is also the `aud` of every ID token Google
   issues to this app, which is what the backend will check.

### Self-hosted alternative: Keycloak

Add to `backend/docker-compose.yml`:

```yaml
  keycloak:
    image: quay.io/keycloak/keycloak:26.0
    command: start-dev
    environment:
      KC_BOOTSTRAP_ADMIN_USERNAME: admin
      KC_BOOTSTRAP_ADMIN_PASSWORD: admin
    ports:
      - "8080:8080"
```

In the admin console (`http://localhost:8080`) create a realm `todos`, a client `frontend` (type
OpenID Connect, client authentication on, redirect URI `http://localhost:3000/api/auth/callback/keycloak`)
and a test user. The issuer is then `http://localhost:8080/realms/todos` and Auth.js has a ready-made
`Keycloak` provider (`AUTH_KEYCLOAK_ID`, `AUTH_KEYCLOAK_SECRET`, `AUTH_KEYCLOAK_ISSUER`).

## 3. Frontend (Next.js)

### 3.1 Install and configure

```bash
cd frontend
npm i next-auth@beta
npx auth secret            # writes AUTH_SECRET to .env.local
```

`.env.local` (never committed; `.gitignore` already excludes it):

```ini
AUTH_SECRET=...            # generated above, encrypts the session cookie
AUTH_GOOGLE_ID=...         # client id from step 2
AUTH_GOOGLE_SECRET=...     # client secret from step 2
NEXT_PUBLIC_API_URL=http://localhost:3001
```

Auth.js reads `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` by convention, so the provider needs no options.

### 3.2 The Auth.js configuration: `src/auth.ts`

```ts
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

// Add the field we put on the session so TypeScript knows about it.
declare module "next-auth" {
  interface Session {
    idToken?: string;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  callbacks: {
    // Runs whenever the session JWT is created or read. `account` exists only at sign-in time.
    jwt({ token, account }) {
      if (account?.id_token) token.idToken = account.id_token;
      return token;
    },
    // Shapes what useSession() / getSession() return on the client.
    session({ session, token }) {
      session.idToken = token.idToken as string | undefined;
      return session;
    },
  },
});
```

### 3.3 The route handler: `src/app/api/auth/[...nextauth]/route.ts`

```ts
import { handlers } from "@/auth";

export const { GET, POST } = handlers;
```

This single file serves sign-in, the callback, sign-out and the session endpoint under `/api/auth/*`.

### 3.4 Make the session available to client components: `src/app/layout.tsx`

```tsx
import { SessionProvider } from "next-auth/react";

// inside RootLayout
<body className="min-h-full flex flex-col">
  <SessionProvider>{children}</SessionProvider>
</body>
```

### 3.5 Sign in, sign out, and only load todos when signed in: `src/app/page.tsx`

The page is a client component, so it uses the client helpers from `next-auth/react`:

```tsx
import { signIn, signOut, useSession } from "next-auth/react";

export default function Home() {
  const { data: session, status } = useSession();
  // ...existing state...

  useEffect(() => {
    if (!session) return;
    api.GET("/todos").then(({ data }) => setTodos((data ?? []).map(toTodo)));
  }, [session]);

  if (status === "loading") return null;
  if (!session) {
    return (
      <main className="mx-auto grid w-full max-w-3xl gap-8 p-8">
        <Button onClick={() => signIn("google")}>Sign in with Google</Button>
      </main>
    );
  }

  return (
    <main className="mx-auto grid w-full max-w-3xl gap-8 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Todos</h1>
        <div className="flex gap-2">
          <span className="text-sm text-muted-foreground">{session.user?.email}</span>
          <Button variant="outline" onClick={() => signOut()}>Sign out</Button>
          <Button onClick={openNew}>New todo</Button>
        </div>
      </div>
      {/* list and form unchanged */}
    </main>
  );
}
```

### 3.6 Attach the token to every API call: `src/lib/api.ts`

`openapi-fetch` supports middleware. One middleware reads the session and sets the header, so no call
site changes:

```ts
import createClient, { type Middleware } from "openapi-fetch";
import { getSession } from "next-auth/react";
import type { components, paths } from "./api-types";

export type ApiTodo = components["schemas"]["Todo"];

export const api = createClient<paths>({
  baseUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001",
});

const withAuth: Middleware = {
  async onRequest({ request }) {
    const session = await getSession();
    if (session?.idToken) request.headers.set("Authorization", `Bearer ${session.idToken}`);
    return request;
  },
};

api.use(withAuth);
```

### 3.7 Optional: block the page on the server

Instead of rendering the sign-in button inside the page, a proxy can redirect anonymous visitors before
the page renders. In `src/proxy.ts` (this file was called `middleware.ts` before Next.js 16):

```ts
export { auth as proxy } from "@/auth";

export const config = { matcher: ["/((?!api/auth|_next|favicon.ico).*)"] };
```

Combine it with `pages: { signIn: "/login" }` in the Auth.js config and a `/login` page with the button.

**Caveat:** Google ID tokens expire after one hour and Auth.js does not renew them by itself. For a class
demo, signing in again is fine. For real use, implement refresh-token rotation in the `jwt` callback
(Auth.js guide "Refresh token rotation") or use an IdP that issues long-lived access tokens for your API.

## 4. Backend (Nest.js)

### 4.1 Install

```bash
cd backend
npm i @nestjs/passport passport passport-jwt jwks-rsa
npm i -D @types/passport-jwt
```

Environment variables (for Google):

```ini
OIDC_ISSUER=https://accounts.google.com
OIDC_AUDIENCE=<the Google client id>
OIDC_JWKS_URI=https://www.googleapis.com/oauth2/v3/certs
```

For Keycloak: `OIDC_ISSUER=http://localhost:8080/realms/todos`, `OIDC_AUDIENCE=frontend`,
`OIDC_JWKS_URI=http://localhost:8080/realms/todos/protocol/openid-connect/certs`. Any OIDC provider
publishes these values at `<issuer>/.well-known/openid-configuration`.

### 4.2 Verify tokens: `src/auth/jwt.strategy.ts`

```ts
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import jwksRsa from 'jwks-rsa';
import { ExtractJwt, Strategy } from 'passport-jwt';

export type AuthUser = { id: string; email?: string };

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      algorithms: ['RS256'],
      issuer: process.env.OIDC_ISSUER,
      audience: process.env.OIDC_AUDIENCE,
      // Fetches the provider's public keys once (cached) and picks the one matching the token's `kid`.
      secretOrKeyProvider: jwksRsa.passportJwtSecret({
        jwksUri: process.env.OIDC_JWKS_URI!,
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
```

No secret is shared between the IdP and the API: verification uses the IdP's public keys, downloaded from
the JWKS URL. Rotating keys on the IdP side needs no change here.

### 4.3 Require a token everywhere, except where marked public

`src/auth/public.decorator.ts`

```ts
import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);
```

`src/auth/jwt-auth.guard.ts`

```ts
import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC } from './public.decorator.js';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    return isPublic ? true : super.canActivate(context);
  }
}
```

`src/auth/auth.module.ts`, registered in `AppModule.imports`:

```ts
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PassportModule } from '@nestjs/passport';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { JwtStrategy } from './jwt.strategy.js';

@Module({
  imports: [PassportModule],
  providers: [JwtStrategy, { provide: APP_GUARD, useClass: JwtAuthGuard }],
})
export class AuthModule {}
```

`APP_GUARD` makes the guard global: every route answers `401 Unauthorized` without a valid bearer token.
Put `@Public()` on `AppController.getHello()` so `GET /` stays open as a health check. Swagger UI (`/api`)
is served by Express middleware, not by a Nest controller, so the guard does not block it.

### 4.4 Scope todos to the signed-in user

`src/auth/current-user.decorator.ts`

```ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthUser } from './jwt.strategy.js';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user,
);
```

Entity: add the owner to `Todo` in `src/todos/todo.schema.ts`.

```ts
@Prop({ required: true, index: true })
owner: string;
```

`owner` is not in `CreateTodoDto`, and the `ValidationPipe` runs with `whitelist: true`, so a client cannot
set it; the server always does. Service: every query includes the owner.

```ts
create(owner: string, dto: CreateTodoDto) {
  return this.model.create({ ...dto, owner });
}

findAll(owner: string) {
  return this.model.find({ owner }).sort({ createdAt: -1 }).exec();
}

async findOne(owner: string, id: string) {
  const todo = await this.model.findOne({ _id: id, owner }).exec();
  if (!todo) throw new NotFoundException(`Todo ${id} not found`);
  return todo;
}
// update and remove: same change, findOneAndUpdate({ _id: id, owner }, ...) and findOneAndDelete({ _id: id, owner })
```

Controller: inject the user.

```ts
@Get()
findAll(@CurrentUser() user: AuthUser): Promise<Todo[]> {
  return this.todos.findAll(user.id);
}
```

Someone else's todo id answers `404`, not `403`, so the API does not reveal that the id exists.

### 4.5 Swagger: let the UI send the token

`src/swagger.ts`:

```ts
const config = new DocumentBuilder()
  .setTitle('Todos API')
  .addBearerAuth()        // adds the "Authorize" button and the `bearer` security scheme
  .build();
```

and `@ApiBearerAuth()` on `TodosController` so the document marks those routes as protected. To try a call
from Swagger UI, paste an ID token (from the browser: `await fetch('/api/auth/session').then(r => r.json())`
on the frontend prints the session, including `idToken`).

### 4.6 Regenerate the contract

The OpenAPI document now contains a `securitySchemes.bearer` entry and `owner` on `Todo`:

```bash
cd backend && npm run openapi
cd ../frontend && npm run api:types
```

The generated types do not change the call sites (the header is added by the middleware), which is the
point of step 3.6.

## 5. Checklist

- `curl localhost:3001/todos` → `401`.
- `curl -H "Authorization: Bearer <id token>" localhost:3001/todos` → `200` with only that user's todos.
- A token with the wrong audience (another Google client id) → `401`.
- Sign in on the frontend, create a todo, sign in with another Google account: the first todo is not listed.
- Swagger UI → Authorize → paste the token → `GET /todos` works.

## 6. Environment variables summary

| App | Variable | Value |
|---|---|---|
| frontend | `AUTH_SECRET` | random string from `npx auth secret` |
| frontend | `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | from Google Cloud Console |
| frontend | `NEXT_PUBLIC_API_URL` | `http://localhost:3001` |
| backend | `OIDC_ISSUER` | `https://accounts.google.com` |
| backend | `OIDC_AUDIENCE` | the Google client id |
| backend | `OIDC_JWKS_URI` | `https://www.googleapis.com/oauth2/v3/certs` |
| backend | `MONGO_URI` | `mongodb://localhost:27017/todos` (default) |
