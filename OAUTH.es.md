# Cómo habilitar el inicio de sesión con OAuth 2.0 / OpenID Connect en el frontend y el backend

*English version: [OAUTH.md](OAUTH.md)*

> **Estado:** aplicado al código en esta rama (`full-google-auth`) con Google: toda ruta de la API excepto
> `GET /` requiere iniciar sesión. La versión de guía práctica (how-to), sin nada aplicado, está en `full-api`.
> El resultado es una app de tareas en la que cada usuario inicia sesión con Google (o cualquier proveedor
> OpenID Connect) y solo ve sus propias tareas.
> Para ejecutarla, completa las variables de la sección 6.

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

Los valores `...` de arriba son marcadores de posición. Si pegas este bloque después de ejecutar
`npx auth secret`, sobrescribes el secreto generado con el texto literal `...`. Deja una sola línea
`AUTH_SECRET` real (`openssl rand -base64 33` también sirve).

Reinicia `npm run dev` después de instalar `next-auth`. Un servidor de desarrollo iniciado antes de la
instalación (o antes de un cambio de rama) puede quedarse recargando la página en un bucle.

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

Variables de entorno (para Google), en `backend/.env` (nunca se sube al repositorio; `backend/.gitignore` ya
lo excluye):

```ini
OIDC_ISSUER=https://accounts.google.com
OIDC_AUDIENCE=<the Google client id>
OIDC_JWKS_URI=https://www.googleapis.com/oauth2/v3/certs
PORT=3001                                  # Next.js already uses 3000
MONGO_URI=mongodb://localhost:27017/todos
```

Para Keycloak: `OIDC_ISSUER=http://localhost:8080/realms/todos`, `OIDC_AUDIENCE=frontend`,
`OIDC_JWKS_URI=http://localhost:8080/realms/todos/protocol/openid-connect/certs`. Cualquier proveedor OIDC
publica estos valores en `<issuer>/.well-known/openid-configuration`.

Nest no lee `.env` por sí solo, pero Node sí puede (`process.loadEnvFile()`, Node >= 20.12, sin
dependencias). Pon la llamada en su propio módulo, `src/env.ts`:

```ts
// Loads backend/.env (OIDC_*, PORT, MONGO_URI) if present.
try {
  process.loadEnvFile();
} catch {
  // no .env: fall back to the variables already in the environment
}
```

e impórtalo en la **primera línea** de `src/main.ts`:

```ts
import './env.js';
import { ValidationPipe } from '@nestjs/common';
// ...the rest unchanged
```

¿Por qué no llamar a `process.loadEnvFile()` dentro del propio `main.ts`? Los módulos ES ejecutan todos los
imports antes del cuerpo del archivo que los importa. `app.module.ts` lee `MONGO_URI` mientras se importa, así
que una llamada en el cuerpo de `main.ts` se ejecutaría demasiado tarde y el valor de `.env` se ignoraría.
`loadEnvFile()` lee `.env` del directorio actual, así que inicia la API desde `backend/`.

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
```

El IdP y la API no comparten ningún secreto: la verificación usa las claves públicas del IdP, descargadas de
la URL del JWKS. Rotar las claves del lado del IdP no requiere ningún cambio aquí.

La comprobación del principio es una medida de seguridad, no solo un error más claro. Cuando `issuer` o
`audience` es `undefined`, `passport-jwt` omite esa verificación sin avisar, así que una variable olvidada
aceptaría un ID token válido de Google emitido para **cualquier otra app**. Con la comprobación, un `.env`
faltante o no cargado detiene la API al arrancar.

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
Swagger UI (`/api`) lo sirve un middleware de Express, no un controlador de Nest, así que el guard no lo
bloquea.

Pon `@Public()` en `AppController.getHello()` para que `GET /` siga abierto como health check,
en `src/app.controller.ts`:

```ts
import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service.js';
import { Public } from './auth/public.decorator.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Public() // health check stays open
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
```

`@Public()` también funciona en una clase: `@Public() @Controller('docs') export class DocsController {}` abre
todas las rutas de ese controlador. El guard mira primero el handler y luego la clase.

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

Controlador: inyecta el usuario en los cinco handlers y pasa `user.id` como primer argumento. El
`src/todos/todos.controller.ts` completo, incluida la anotación de Swagger de 4.5:

```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ParseObjectIdPipe } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthUser } from '../auth/jwt.strategy.js';
import { CreateTodoDto } from './dto/create-todo.dto.js';
import { UpdateTodoDto } from './dto/update-todo.dto.js';
import { Todo } from './todo.schema.js';
import { TodosService } from './todos.service.js';

@ApiTags('todos')
@ApiBearerAuth() // 4.5: Swagger marks these routes as needing the bearer token
@Controller('todos')
export class TodosController {
  constructor(private readonly todos: TodosService) {}

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateTodoDto,
  ): Promise<Todo> {
    return this.todos.create(user.id, dto);
  }

  @Get()
  findAll(@CurrentUser() user: AuthUser): Promise<Todo[]> {
    return this.todos.findAll(user.id);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<Todo> {
    return this.todos.findOne(user.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateTodoDto,
  ): Promise<Todo> {
    return this.todos.update(user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<void> {
    return this.todos.remove(user.id, id);
  }
}
```

No hay ninguna anotación que active el guard: con `APP_GUARD` toda ruta está protegida por defecto.
Las anotaciones solo crean excepciones o leen el resultado:

| Anotación | Va en | Qué hace |
|---|---|---|
| `@Public()` | un handler o una clase de controlador | deja pasar la petición sin token (4.3) |
| `@CurrentUser()` | un parámetro de un handler | le da al handler `{ id, email }` del token verificado, es decir, `req.user` (4.4) |
| `@ApiBearerAuth()` | una clase de controlador o un handler | Solo para Swagger: muestra un candado y envía el token de "Authorize". No protege nada (4.5) |

`@CurrentUser()` en una ruta `@Public()` da `undefined`, porque el guard omitió la verificación del token.

El id de una tarea de otra persona responde `404`, no `403`, así que la API no revela que el id existe.

Las tareas creadas antes de este paso no tienen `owner`, así que ya ningún usuario las ve. Bórralas:

```bash
cd backend && docker compose exec mongo mongosh todos --eval 'db.todos.deleteMany({ owner: { $exists: false } })'
```

### 4.5 Swagger: deja que la UI envíe el token

`src/swagger.ts`:

```ts
const config = new DocumentBuilder()
  .setTitle('Todos API')
  .addBearerAuth()        // adds the "Authorize" button and the `bearer` security scheme
  .build();
```

y `@ApiBearerAuth()` en `TodosController` (ver el controlador completo en 4.4) para que el documento marque
esas rutas como protegidas. Para probar una llamada
desde Swagger UI, pega un ID token (desde el navegador: `await fetch('/api/auth/session').then(r => r.json())`
en el frontend imprime la sesión, incluido `idToken`).

### 4.6 Regenera el contrato

`npm run openapi` y la prueba e2e (`test/app.e2e-spec.ts`) arrancan todo el `AppModule` sin leer `.env`, así
que la comprobación de la estrategia de 4.2 los detiene. Ninguno de los dos verifica un token, así que dales
marcadores de posición. Agrega esto a `src/openapi.ts` antes de `NestFactory.create`, y a la prueba e2e
después de sus imports:

```ts
// The JwtStrategy needs these to construct; no token is verified here, so placeholders are fine.
process.env.OIDC_ISSUER ??= 'https://accounts.google.com';
process.env.OIDC_AUDIENCE ??= 'todos-api';
process.env.OIDC_JWKS_URI ??= 'https://www.googleapis.com/oauth2/v3/certs';
```

El documento OpenAPI ahora contiene una entrada `securitySchemes.bearer` y `owner` en `Todo`:

```bash
cd backend && npm run openapi
cd ../frontend && npm run api:types
```

Los tipos generados no cambian las llamadas (el encabezado lo agrega el middleware), que es justamente el
objetivo del paso 3.6.

## 5. Lista de verificación

- `curl localhost:3001/` → `200` (health check público).
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
| backend | `PORT` | `3001` (el 3000 por defecto choca con Next.js) |
| backend | `MONGO_URI` | `mongodb://localhost:27017/todos` (por defecto) |

Las variables del frontend van en `frontend/.env.local`, y las del backend en `backend/.env`. Git ignora
ambos archivos.

## 7. Solución de problemas

| Síntoma | Causa y solución |
|---|---|
| La API se detiene al arrancar con `Set OIDC_ISSUER, OIDC_AUDIENCE and OIDC_JWKS_URI` | Falta `backend/.env`, tiene otros nombres de variables (p. ej. `AUTH0_*` de otra guía) o no se cargó: revisa el `import './env.js'` de 4.1 e inicia la API desde `backend/`. |
| Google muestra `Error 400: redirect_uri_mismatch` | La URI de redirección del paso 2 no está registrada, o difiere en algún carácter. Debe ser exactamente `http://localhost:3000/api/auth/callback/google` (http, puerto 3000, sin barra final). Los cambios en Google Cloud Console pueden tardar unos minutos. |
| La página queda en blanco o se recarga en un bucle | El servidor de `next dev` se inició antes de instalar `next-auth` o antes de un cambio de rama. Detenlo y vuelve a ejecutar `npm run dev`. |
| Con la sesión iniciada, todas las llamadas responden `401` | El ID token venció (dura una hora, ver la advertencia en 3.7): cierra sesión y vuelve a iniciarla. Si falla justo después de iniciar sesión, `OIDC_AUDIENCE` es distinto de `AUTH_GOOGLE_ID`. |
| Con la sesión iniciada, la lista está vacía aunque la base de datos tiene tareas | Esas tareas se crearon antes de que existiera el inicio de sesión y no tienen `owner` (ver 4.4). |
| La API falla con `EADDRINUSE` en el puerto 3000, o el frontend no puede llegar a ella | Falta `PORT=3001` en `backend/.env`. |
| Con la sesión iniciada, las llamadas a `localhost:3000/todos` responden `404` | `NEXT_PUBLIC_API_URL` apunta a Next.js (3000) en lugar de a la API (3001). Corrígelo en `frontend/.env.local` y reinicia `npm run dev`: los valores `NEXT_PUBLIC_*` se incorporan al código del navegador. |
