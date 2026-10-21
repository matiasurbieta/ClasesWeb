# ClasesWeb: una app de tareas en Next.js y Nest.js

*English version: [README.md](README.md)*

Proyecto didáctico con dos apps:

- `frontend/`: Next.js 16, React 19, shadcn/ui. Entidad, lista y formulario en diálogo para `Todo`.
- `backend/`: Nest.js 12, MongoDB a través de Mongoose, Swagger/OpenAPI generado por el plugin del CLI.

## Ramas

Cada rama es una etapa del curso. `main` tiene el mismo código que `full-apps`.

| Rama | Qué contiene | Guía a seguir |
|---|---|---|
| `initial` | Punto de partida: componentes de UI sin estado, página vacía, API del backend completa. | `frontend/TODO-LOGIC.es.md`, `backend/TODO-API.es.md` |
| `full-apps` | La guía del frontend aplicada (tareas en un array en memoria, crear, marcar como hecha, editar) más la generación del cliente OpenAPI configurada. | `frontend/API-CLIENT.es.md` |
| `full-api` | El frontend habla con el backend a través del cliente generado, más una guía práctica para agregar login con OAuth a ambas apps. | `OAUTH.es.md` |
| `full-google-auth` | `OAUTH.es.md` aplicado con Google como proveedor de identidad (IdP): inicio de sesión en el frontend, verificación del ID token y tareas por usuario en el backend. | `OAUTH.es.md` |
| `full-auth0` | `OAUTH.es.md` aplicado con Auth0 como proveedor de identidad (IdP): inicio de sesión en el frontend, verificación del token bearer y tareas por usuario en el backend. | `AUTH0.es.md` |

## Ejecutar

```bash
# backend (MongoDB in Docker, API on http://localhost:3001, Swagger UI on /api)
cd backend && docker compose up -d && PORT=3001 npm run start:dev

# frontend (http://localhost:3000)
cd frontend && npm run dev
```

En `full-google-auth` y `full-auth0` ambas apps también necesitan sus variables en `backend/.env` y
`frontend/.env.local`: mira la sección 6 de `OAUTH.es.md` o `AUTH0.es.md` en esa rama.
