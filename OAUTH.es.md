# Cómo habilitar el inicio de sesión con OAuth 2.0 / OpenID Connect en el frontend y el backend

*English version: [OAUTH.md](OAUTH.md)*

> **Estado:** guía práctica (how-to), no aplicada al código. Nada en esta rama requiere iniciar sesión todavía.
> Los fragmentos son el punto de partida del ejercicio; síguelos en orden y el resultado es una app de tareas
> en la que cada usuario inicia sesión con Google (o cualquier proveedor OpenID Connect) y solo ve sus propias
> tareas.

## 1. Qué agregamos y cómo funciona

Hoy cualquiera puede llamar a `POST /todos`. El objetivo: los usuarios inician sesión con un proveedor de
identidad, la app de Next.js recibe un token, lo envía en cada llamada a la API, y la API de Nest acepta solo
tokens válidos y limita las tareas al usuario que inició sesión.

El vocabulario de OAuth 2.0 / OIDC aplicado a este proyecto:

| Rol | En este proyecto |
|---|---|
| Propietario del recurso (resource owner) | la persona que usa la app |
| Cliente (client) | la app de Next.js (`frontend/`) |
| Servidor de autorización (authorization server) / proveedor de identidad (IdP) | Google en esta guía. Keycloak, Auth0, Microsoft Entra o cualquier proveedor OpenID Connect funciona de la misma manera. |
| Servidor de recursos (resource server) | la API de Nest (`backend/`) |

Nunca manejamos contraseñas. El flujo es **Authorization Code con PKCE**, implementado en el frontend por
[Auth.js](https://authjs.dev) (la biblioteca que antes se llamaba NextAuth):

1. El usuario hace clic en **Sign in**. Auth.js redirige el navegador a Google con un `code_challenge` de un
   solo uso.
2. Google autentica al usuario y redirige de vuelta a `http://localhost:3000/api/auth/callback/google?code=...`.
3. Auth.js, en el servidor, intercambia el código por tokens: un `id_token` (un JWT firmado con `sub`, `email`,
   `name`) y un `access_token`.
4. Auth.js guarda la sesión en una cookie cifrada. Copiamos el `id_token` en esa sesión.
5. Cada llamada a la API desde el frontend agrega `Authorization: Bearer <id_token>`.
6. La API verifica el token sin conexión (offline): la firma contra las claves públicas que publica Google
   (JWKS), `iss`, `aud` y `exp`. El claim `sub` es el id estable del usuario.

Qué token enviar: los tokens de acceso de Google son cadenas opacas que solo Google puede comprobar, así que
para nuestra propia API (first-party) enviamos el **ID token**, que es un JWT que podemos verificar nosotros
mismos. Con Keycloak o Auth0, en cambio, pedirías un **token de acceso** emitido para la audiencia (audience)
de tu API; el código del backend de más abajo no cambia, solo cambian las tres variables de entorno.

## 2. Registra la app en el proveedor

### Google

1. [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → Credentials → Create
   credentials → OAuth client ID → Application type: Web application.
2. Authorized JavaScript origins: `http://localhost:3000`.
3. Authorized redirect URIs: `http://localhost:3000/api/auth/callback/google`.
4. Copia el **Client ID** y el **Client secret**. El Client ID también es el `aud` de cada ID token que Google
   emite para esta app, que es lo que va a comprobar el backend.

### Alternativa autoalojada: Keycloak

Agrega a `backend/docker-compose.yml`:

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

En la consola de administración (`http://localhost:8080`) crea un realm `todos`, un cliente `frontend` (tipo
OpenID Connect, client authentication activado, URI de redirección
`http://localhost:3000/api/auth/callback/keycloak`) y un usuario de prueba. El emisor (issuer) es entonces
`http://localhost:8080/realms/todos` y Auth.js tiene un proveedor `Keycloak` listo para usar
(`AUTH_KEYCLOAK_ID`, `AUTH_KEYCLOAK_SECRET`, `AUTH_KEYCLOAK_ISSUER`).

## 3. Frontend (Next.js)

### 3.1 Instala y configura

```bash
cd frontend
npm i next-auth@beta
npx auth secret            # writes AUTH_SECRET to .env.local
```

`.env.local` (nunca se sube al repositorio; `.gitignore` ya lo excluye):

```ini
AUTH_SECRET=...            # generated above, encrypts the session cookie
AUTH_GOOGLE_ID=...         # client id from step 2
AUTH_GOOGLE_SECRET=...     # client secret from step 2
NEXT_PUBLIC_API_URL=http://localhost:3001
```

Auth.js lee `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` por convención, así que el proveedor no necesita opciones.

### 3.2 La configuración de Auth.js: `src/auth.ts`

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

### 3.3 El route handler: `src/app/api/auth/[...nextauth]/route.ts`

```ts
import { handlers } from "@/auth";

export const { GET, POST } = handlers;
```

Este único archivo atiende el inicio de sesión, el callback, el cierre de sesión y el endpoint de la sesión
bajo `/api/auth/*`.

### 3.4 Haz que la sesión esté disponible para los componentes de cliente: `src/app/layout.tsx`

```tsx
import { SessionProvider } from "next-auth/react";

// inside RootLayout
<body className="min-h-full flex flex-col">
  <SessionProvider>{children}</SessionProvider>
</body>
```

### 3.5 Inicia sesión, cierra sesión y carga las tareas solo con la sesión iniciada: `src/app/page.tsx`

La página es un componente de cliente, así que usa las funciones auxiliares de cliente de `next-auth/react`:

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

### 3.6 Adjunta el token a cada llamada a la API: `src/lib/api.ts`

`openapi-fetch` admite middleware. Un middleware lee la sesión y establece el encabezado, así que no hay que
cambiar ninguna llamada:

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

### 3.7 Opcional: bloquea la página en el servidor

En lugar de mostrar el botón de inicio de sesión dentro de la página, un proxy puede redirigir a los
visitantes anónimos antes de que la página se renderice. En `src/proxy.ts` (este archivo se llamaba
`middleware.ts` antes de Next.js 16):

```ts
export { auth as proxy } from "@/auth";

export const config = { matcher: ["/((?!api/auth|_next|favicon.ico).*)"] };
```

Combínalo con `pages: { signIn: "/login" }` en la configuración de Auth.js y una página `/login` con el botón.

**Advertencia:** los ID tokens de Google vencen después de una hora y Auth.js no los renueva por sí solo. Para
una demo en clase, volver a iniciar sesión está bien. Para un uso real, implementa la rotación de refresh
tokens en el callback `jwt` (guía de Auth.js "Refresh token rotation") o usa un IdP que emita tokens de acceso
de larga duración para tu API.

## 4. Backend (Nest.js)

### 4.1 Instala

```bash
cd backend
npm i @nestjs/passport passport passport-jwt jwks-rsa
npm i -D @types/passport-jwt
```

Variables de entorno (para Google):

```ini
OIDC_ISSUER=https://accounts.google.com
OIDC_AUDIENCE=<the Google client id>
OIDC_JWKS_URI=https://www.googleapis.com/oauth2/v3/certs
```

Para Keycloak: `OIDC_ISSUER=http://localhost:8080/realms/todos`, `OIDC_AUDIENCE=frontend`,
`OIDC_JWKS_URI=http://localhost:8080/realms/todos/protocol/openid-connect/certs`. Cualquier proveedor OIDC
publica estos valores en `<issuer>/.well-known/openid-configuration`.

### 4.2 Verifica los tokens: `src/auth/jwt.strategy.ts`

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

El IdP y la API no comparten ningún secreto: la verificación usa las claves públicas del IdP, descargadas de
la URL del JWKS. Rotar las claves del lado del IdP no requiere ningún cambio aquí.

### 4.3 Exige un token en todas partes, excepto donde se marque como público

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

`src/auth/auth.module.ts`, registrado en `AppModule.imports`:

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

`APP_GUARD` hace que el guard sea global: toda ruta responde `401 Unauthorized` sin un token bearer válido.
Pon `@Public()` en `AppController.getHello()` para que `GET /` siga abierto como health check. Swagger UI
(`/api`) lo sirve un middleware de Express, no un controlador de Nest, así que el guard no lo bloquea.

### 4.4 Limita las tareas al usuario que inició sesión

`src/auth/current-user.decorator.ts`

```ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthUser } from './jwt.strategy.js';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user,
);
```

Entidad: agrega el propietario a `Todo` en `src/todos/todo.schema.ts`.

```ts
@Prop({ required: true, index: true })
owner: string;
```

`owner` no está en `CreateTodoDto`, y el `ValidationPipe` se ejecuta con `whitelist: true`, así que un
cliente no puede asignarlo; siempre lo asigna el servidor. Servicio: cada consulta incluye el propietario.

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

Controlador: inyecta el usuario.

```ts
@Get()
findAll(@CurrentUser() user: AuthUser): Promise<Todo[]> {
  return this.todos.findAll(user.id);
}
```

El id de una tarea de otra persona responde `404`, no `403`, así que la API no revela que el id existe.

### 4.5 Swagger: deja que la UI envíe el token

`src/swagger.ts`:

```ts
const config = new DocumentBuilder()
  .setTitle('Todos API')
  .addBearerAuth()        // adds the "Authorize" button and the `bearer` security scheme
  .build();
```

y `@ApiBearerAuth()` en `TodosController` para que el documento marque esas rutas como protegidas. Para
probar una llamada
desde Swagger UI, pega un ID token (desde el navegador: `await fetch('/api/auth/session').then(r => r.json())`
en el frontend imprime la sesión, incluido `idToken`).

### 4.6 Regenera el contrato

El documento OpenAPI ahora contiene una entrada `securitySchemes.bearer` y `owner` en `Todo`:

```bash
cd backend && npm run openapi
cd ../frontend && npm run api:types
```

Los tipos generados no cambian las llamadas (el encabezado lo agrega el middleware), que es justamente el
objetivo del paso 3.6.

## 5. Lista de verificación

- `curl localhost:3001/todos` → `401`.
- `curl -H "Authorization: Bearer <id token>" localhost:3001/todos` → `200` solo con las tareas de ese usuario.
- Un token con la audiencia equivocada (otro Client ID de Google) → `401`.
- Inicia sesión en el frontend, crea una tarea, inicia sesión con otra cuenta de Google: la primera tarea no
  aparece en la lista.
- Swagger UI → Authorize → pega el token → `GET /todos` funciona.

## 6. Resumen de variables de entorno

| App | Variable | Valor |
|---|---|---|
| frontend | `AUTH_SECRET` | cadena aleatoria generada con `npx auth secret` |
| frontend | `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | de Google Cloud Console |
| frontend | `NEXT_PUBLIC_API_URL` | `http://localhost:3001` |
| backend | `OIDC_ISSUER` | `https://accounts.google.com` |
| backend | `OIDC_AUDIENCE` | el Client ID de Google |
| backend | `OIDC_JWKS_URI` | `https://www.googleapis.com/oauth2/v3/certs` |
| backend | `MONGO_URI` | `mongodb://localhost:27017/todos` (por defecto) |
