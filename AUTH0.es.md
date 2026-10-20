# Login con Auth0 en el frontend y el backend

*English version: [AUTH0.md](AUTH0.md)*

> **Estado:** aplicado en esta rama. `OAUTH.es.md` (rama `full-api`) explica los conceptos: roles, el flujo
> Authorization Code + PKCE, Auth.js en el frontend, Passport JWT en el backend. Este documento cubre la
> configuración específica de Auth0, lo que difiere de esa guía y lo que cambió en el código.

## 1. Qué difiere de `OAUTH.es.md`

| Tema | `OAUTH.es.md` (Google) | Esta rama (Auth0) |
|---|---|---|
| Proveedor de Auth.js | `Google`, env `AUTH_GOOGLE_*` | `Auth0`, env `AUTH_AUTH0_ID`, `AUTH_AUTH0_SECRET`, `AUTH_AUTH0_ISSUER` |
| Token enviado a la API | el **ID token** (los tokens de acceso de Google son opacos) | el **token de acceso**, solicitado para la `audience` de nuestra API |
| Variables del backend | `OIDC_ISSUER`, `OIDC_AUDIENCE`, `OIDC_JWKS_URI` | `AUTH0_ISSUER`, `AUTH0_AUDIENCE` (la URL de JWKS es siempre `<issuer>.well-known/jwks.json`) |

Por qué el token de acceso: Auth0 emite un token de acceso JWT verificable solo cuando la petición de inicio de
sesión indica una `audience`, el identificador de una **API registrada en el tenant**. Ese token lleva
`aud = <identifier>` y `sub = <user id>`, que es exactamente lo que debe comprobar un servidor de recursos. Los
ID tokens están pensados para la app cliente, y Auth0 los rechaza como credenciales de API por diseño. El código
del backend es la misma estrategia de Passport que en `OAUTH.es.md`; solo que los claims que espera vienen de un
token distinto.

## 2. Configuración en el dashboard de Auth0

1. Crea un tenant gratuito en <https://auth0.com>. Anota el **Domain** (p. ej. `acme.us.auth0.com`).
2. **Applications → Create Application** → nombre `Todos frontend`, tipo **Regular Web Applications**.
   En *Settings* completa estos campos y guarda:
   - Allowed Callback URLs: `http://localhost:3000/api/auth/callback/auth0`
   - Allowed Logout URLs: `http://localhost:3000`
   - Allowed Web Origins: `http://localhost:3000`

   Copia el **Client ID** y el **Client Secret**.
3. **Applications → APIs → Create API** → nombre `Todos API`, identificador `http://localhost:3001`
   (sirve cualquier URI; es un identificador, Auth0 nunca lo llama), algoritmo de firma **RS256**.
   El identificador es la `audience` que usan ambas apps.
4. Un usuario con el que iniciar sesión: el tenant viene con una conexión de base de datos, así que **Sign up**
   en la página de inicio de sesión funciona, o puedes crear uno en **User Management → Users**. El inicio de
   sesión social con Google está habilitado por defecto con las claves de desarrollo de Auth0.

## 3. Configura y ejecuta

```bash
# backend/.env (gitignored)
cp backend/.env.example backend/.env          # AUTH0_ISSUER=https://<domain>/  AUTH0_AUDIENCE=http://localhost:3001

# frontend/.env.local (gitignored)
cp frontend/.env.example frontend/.env.local  # AUTH_AUTH0_ID, AUTH_AUTH0_SECRET, AUTH_AUTH0_ISSUER=https://<domain>, AUTH0_AUDIENCE
cd frontend && npx auth secret                # appends AUTH_SECRET
```

`AUTH0_ISSUER` en el backend debe coincidir exactamente con el claim `iss` del token, y Auth0 lo escribe **con
una barra final**: `https://acme.us.auth0.com/`. Auth.js acepta el emisor (issuer) del frontend con o sin ella.

```bash
cd backend && docker compose up -d && npm run start:dev   # reads .env, API on :3001
cd frontend && npm run dev                                # http://localhost:3000
```

## 4. Qué cambió en el código

Frontend (`frontend/`):

| Archivo | Cambio |
|---|---|
| `src/auth.ts` | Configuración de Auth.js: proveedor `Auth0` con `authorization.params.audience`; los callbacks `jwt`/`session` copian `account.access_token` a `session.accessToken`. |
| `src/app/api/auth/[...nextauth]/route.ts` | Monta el inicio de sesión, el callback, el cierre de sesión y la sesión bajo `/api/auth/*`. |
| `src/app/layout.tsx` | Envuelve la app en `SessionProvider`. |
| `src/app/page.tsx` | `useSession()`: pantalla de inicio de sesión para usuarios anónimos, email + **Sign out** con la sesión iniciada, y las tareas se cargan solo una vez autenticado. |
| `src/lib/api.ts` | Un middleware de `openapi-fetch` agrega `Authorization: Bearer <accessToken>` a cada llamada. |
| `src/lib/api-types.ts` | Regenerado: `owner` en `Todo`, esquema de seguridad `bearer`. |
| `.env.example` | Variables para copiar en `.env.local`. |

Backend (`backend/`):

| Archivo | Cambio |
|---|---|
| `src/auth/jwt.strategy.ts` | Verifica tokens RS256 contra el JWKS del tenant, comprueba `iss`/`aud`/`exp` y pone `{ id: sub, email }` en `req.user`. Falla al arrancar si faltan las dos variables. |
| `src/auth/jwt-auth.guard.ts`, `public.decorator.ts`, `auth.module.ts` | Guard global (`APP_GUARD`); las rutas marcadas con `@Public()` lo saltan. `GET /` es público como health check. |
| `src/auth/current-user.decorator.ts` | Decorador de parámetro `@CurrentUser()`. |
| `src/auth/jwt-auth.guard.spec.ts` | Test con un servidor JWKS local: ruta pública, token ausente, token válido, audiencia (audience) o emisor incorrectos, clave incorrecta. `npm test` no necesita un tenant. |
| `src/todos/todo.schema.ts` | `owner` (el claim `sub`), obligatorio e indexado. |
| `src/todos/todos.service.ts`, `todos.controller.ts` | Cada consulta se limita al owner; el id de otro usuario responde `404`. `owner` no está en los DTOs y el `ValidationPipe` usa whitelist, así que un cliente no puede asignarlo. |
| `src/swagger.ts` | `addBearerAuth()`; `@ApiBearerAuth()` en `TodosController`. |
| `src/main.ts` | `process.loadEnvFile()` lee `.env` cuando existe (sin dependencias, Node ≥ 20.12). |
| `src/openapi.ts` | Valores `AUTH0_*` de relleno para que `npm run openapi` funcione sin un tenant. |
| `openapi.json` | Regenerado. |

## 5. Pruébalo

- `curl -i localhost:3001/todos` → `401`. `curl localhost:3001/` → `200` (público).
- Abre <http://localhost:3000>, haz clic en **Sign in with Auth0**, regístrate o inicia sesión y crea una tarea.
- En la consola del navegador: `await fetch('/api/auth/session').then(r => r.json())` muestra `accessToken`.
  Pégalo en Swagger UI (<http://localhost:3001/api> → **Authorize**) y `GET /todos` devuelve tus tareas.
- Inicia sesión con un segundo usuario: la lista está vacía, y `PATCH /todos/<first user's id>` responde `404`.

## 6. Detalles a tener en cuenta

- **El cierre de sesión es local.** `signOut()` borra la cookie de Auth.js; la cookie de sesión de Auth0 sigue
  ahí, así que el siguiente **Sign in** vuelve a iniciar sesión con el mismo usuario sin preguntar. Para cambiar de
  usuario durante una demo, agrega `prompt: "login"` a `authorization.params` en `src/auth.ts`, o después de
  cerrar sesión redirige el navegador a
  `https://<domain>/v2/logout?client_id=<client id>&returnTo=http://localhost:3000`.
- **Duración del token.** Los tokens de acceso duran 24 h por defecto (API → Settings → Token Expiration). Aquí
  nada los renueva: cuando las llamadas empiecen a responder `401`, vuelve a iniciar sesión. Una renovación real
  necesita el scope `offline_access` más la rotación de refresh tokens en el callback `jwt` (guía de Auth.js
  "Refresh token rotation").
- **`getSession()` en cada llamada.** El middleware de la API consulta `/api/auth/session` antes de cada
  petición. Está bien para una clase; guarda el token en memoria si alguna vez llega a importar.
- **La barra del emisor.** Un `401` en cada petición con un token que parece válido casi siempre se debe a
  `AUTH0_ISSUER` sin la barra final.
