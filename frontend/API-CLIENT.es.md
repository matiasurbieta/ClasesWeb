# Mantener el frontend sincronizado con el backend: generar el cliente de la API desde OpenAPI

*English version: [API-CLIENT.md](API-CLIENT.md)*

El backend publica su contrato como un documento OpenAPI: `../backend/openapi.json`, que también se sirve en vivo en
<http://localhost:3001/api-json>. En lugar de escribir a mano los tipos de las solicitudes y respuestas en el frontend,
los generamos a partir de ese documento. Cuando el backend cambia, regeneramos, y TypeScript señala cada lugar del
frontend que ya no coincide con el contrato.

| Paquete | Rol |
|---|---|
| `openapi-typescript` (dependencia de desarrollo) | Lee `openapi.json` y escribe un único archivo `.ts` con los tipos `paths`, `operations` y `components`. No agrega código en tiempo de ejecución. |
| `openapi-fetch` | Un wrapper mínimo sobre `fetch` tipado con esos `paths`: el compilador verifica la URL, los parámetros de ruta, el body y la respuesta. |

Ambos ya están instalados en este repo; los pasos 1 a 4 son lo que se hizo.

## 1. Instalar

```bash
npm i openapi-fetch
npm i -D openapi-typescript
```

## 2. Agregar el script de generación

En `package.json`:

```json
"scripts": {
  "api:types": "openapi-typescript ../backend/openapi.json -o src/lib/api-types.ts"
}
```

Lee el archivo que el backend guarda en el repo (`npm run openapi` en `../backend` lo regenera). Para leer en cambio de
un backend en ejecución, apúntalo a la URL:

```bash
npx openapi-typescript http://localhost:3001/api-json -o src/lib/api-types.ts
```

## 3. Generar

```bash
npm run api:types
```

Esto escribe `src/lib/api-types.ts`. Es código generado: nunca lo edites, regenéralo. La parte interesante es
`components.schemas`, un tipo por cada schema del documento:

```ts
export interface components {
  schemas: {
    CreateTodoDto: {
      name: string;
      description?: string;
      /** @enum {string} */
      priority?: "low" | "medium" | "high";
      /** @description ISO date  @example 2026-12-31 */
      deadline?: string;
      done?: boolean;
    };
    Todo: {
      _id: string;
      name: string;
      description?: string;
      priority: "low" | "medium" | "high";
      /** Format: date-time */
      deadline?: string;
      done: boolean;
      createdAt: string;
      updatedAt: string;
    };
    UpdateTodoDto: { /* every CreateTodoDto field, optional */ };
  };
}
```

Observa que todo lo que declaró el backend (pasos 3 y 4 de `../backend/TODO-API.es.md`) está aquí: el enum de
`@IsIn(PRIORITIES)`, los campos opcionales de `?`, el formato `date-time` de la propiedad `Date`, el ejemplo del JSDoc.
`paths` y `operations` describen cada ruta: sus parámetros de ruta, el body de la solicitud y el tipo de respuesta para
cada código de estado.

## 4. Crear el cliente tipado: `src/lib/api.ts`

```ts
import createClient from "openapi-fetch";
import type { components, paths } from "./api-types";

/** A Todo exactly as the backend returns it (generated from openapi.json). */
export type ApiTodo = components["schemas"]["Todo"];

export const api = createClient<paths>({
  baseUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001",
});
```

`createClient<paths>` es todo el cliente. El parámetro genérico es lo que hace que cada llamada de abajo esté
verificada por tipos. `NEXT_PUBLIC_API_URL` te permite apuntar a otro backend sin tocar código (Next expone al navegador
las variables `NEXT_PUBLIC_*`).

## 5. Usarlo

```ts
import { api } from "@/lib/api";

const { data, error } = await api.GET("/todos");
// data: ApiTodo[] | undefined   error: set on 4xx/5xx

const created = await api.POST("/todos", { body: { name: "Buy milk", priority: "high" } });
// created.data: ApiTodo | undefined

await api.PATCH("/todos/{id}", { params: { path: { id } }, body: { done: true } });
await api.DELETE("/todos/{id}", { params: { path: { id } } });
```

Lo que ahora rechaza el compilador, en tiempo de compilación en lugar de en tiempo de ejecución:

- `api.GET("/todo")`: ruta desconocida.
- `body: { name: "x", priority: "urgent" }`: no es uno de los valores del enum.
- `body: { description: "no name" }`: `name` es obligatorio.
- `data[0].id`: el campo es `_id`.
- `api.PATCH("/todos/{id}", { body: { done: true } })`: falta el parámetro de ruta.

## 6. Mantenerlo sincronizado

Cada vez que cambia el contrato del backend:

```bash
cd ../backend && npm run openapi      # 1. regenerate openapi.json (needs Mongo running)
cd ../frontend && npm run api:types   # 2. regenerate src/lib/api-types.ts
npx tsc --noEmit                      # 3. the compiler lists every call that no longer matches
```

Haz commit de `openapi.json` y `api-types.ts` junto con el cambio. Renombrar `done` a `completed` en el backend, por
ejemplo, se convierte en errores de tipos en el frontend antes de que se haga deploy de nada.

Un job de CI puede asegurar que los archivos commiteados estén al día: ejecuta los dos comandos de generación y haz que
falle si `git diff --exit-code backend/openapi.json frontend/src/lib/api-types.ts` encuentra diferencias.

## 7. Pasar la página del array en memoria a la API

`src/app/page.tsx` hoy guarda las tareas en `useState(initialTodos)`. Los componentes (`TodoList`, `TodoForm`) no
cambian; solo cambia de dónde vienen los datos.

Primero inicia el backend en otro puerto (ambos usan el 3000 por defecto):

```bash
cd ../backend && docker compose up -d && PORT=3001 npm run start:dev
```

### 7.1 Convertir la forma de la API a la forma de la UI

La API devuelve `_id` y una fecha-hora ISO; el tipo `Todo` de la UI usa `id` y un deadline `YYYY-MM-DD` (lo que
necesita el input de fecha). Una función hace la conversión:

```tsx
import { api, type ApiTodo } from "@/lib/api";
import type { Todo, TodoInput } from "@/lib/todo";

function toTodo(t: ApiTodo): Todo {
  return {
    id: t._id,
    name: t.name,
    description: t.description,
    priority: t.priority,
    deadline: t.deadline?.slice(0, 10),
    done: t.done,
  };
}
```

### 7.2 Cargar desde la API en lugar del array

```tsx
const [todos, setTodos] = useState<Todo[]>([]);

useEffect(() => {
  api.GET("/todos").then(({ data }) => setTodos((data ?? []).map(toTodo)));
}, []);
```

El estado empieza vacío y `useEffect` se ejecuta una vez después del primer render para pedir los datos. Borra el import
de `initialTodos` (y `src/lib/todos.ts` si nada más lo usa).

### 7.3 Crear y actualizar a través de la API

El `TodoInput` que produce el formulario tiene los mismos campos que `CreateTodoDto`, así que se envía tal cual como
body. Cada llamada devuelve la tarea guardada, que reemplaza la copia local: el servidor es la fuente de verdad.

```tsx
function replace(updated: ApiTodo) {
  setTodos((prev) => prev.map((t) => (t.id === updated._id ? toTodo(updated) : t)));
}

async function handleSubmit(input: TodoInput) {
  if (editing) {
    const { data } = await api.PATCH("/todos/{id}", {
      params: { path: { id: editing.id } },
      body: input,
    });
    if (data) replace(data);
  } else {
    const { data } = await api.POST("/todos", { body: input });
    if (data) setTodos((prev) => [toTodo(data), ...prev]);
  }
}

async function handleToggle(todo: Todo) {
  const { data } = await api.PATCH("/todos/{id}", {
    params: { path: { id: todo.id } },
    body: { done: !todo.done },
  });
  if (data) replace(data);
}
```

Las tareas nuevas van al principio de la lista porque `GET /todos` devuelve primero las más recientes. `data` es
`undefined` cuando la solicitud falló; `error` trae el mensaje del backend (por ejemplo, los errores de validación) por
si quieres mostrarlo.

### `src/app/page.tsx` final

```tsx
// src/app/page.tsx
"use client";

import { useEffect, useState } from "react";
import { TodoForm } from "@/components/todo-form";
import { TodoList } from "@/components/todo-list";
import { Button } from "@/components/ui/button";
import { api, type ApiTodo } from "@/lib/api";
import type { Todo, TodoInput } from "@/lib/todo";

/** The API returns `_id` and an ISO date-time; the UI wants `id` and "YYYY-MM-DD". */
function toTodo(t: ApiTodo): Todo {
  return {
    id: t._id,
    name: t.name,
    description: t.description,
    priority: t.priority,
    deadline: t.deadline?.slice(0, 10),
    done: t.done,
  };
}

export default function Home() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Todo>();

  useEffect(() => {
    api.GET("/todos").then(({ data }) => setTodos((data ?? []).map(toTodo)));
  }, []);

  function openNew() {
    setEditing(undefined);
    setOpen(true);
  }

  function openEdit(todo: Todo) {
    setEditing(todo);
    setOpen(true);
  }

  function replace(updated: ApiTodo) {
    setTodos((prev) => prev.map((t) => (t.id === updated._id ? toTodo(updated) : t)));
  }

  async function handleSubmit(input: TodoInput) {
    if (editing) {
      const { data } = await api.PATCH("/todos/{id}", {
        params: { path: { id: editing.id } },
        body: input,
      });
      if (data) replace(data);
    } else {
      const { data } = await api.POST("/todos", { body: input });
      if (data) setTodos((prev) => [toTodo(data), ...prev]);
    }
  }

  async function handleToggle(todo: Todo) {
    const { data } = await api.PATCH("/todos/{id}", {
      params: { path: { id: todo.id } },
      body: { done: !todo.done },
    });
    if (data) replace(data);
  }

  return (
    <main className="mx-auto grid w-full max-w-3xl gap-8 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Todos</h1>
        <Button onClick={openNew}>New todo</Button>
      </div>
      <TodoList todos={todos} onEdit={openEdit} onToggle={handleToggle} />
      <TodoForm open={open} onOpenChange={setOpen} todo={editing} onSubmit={handleSubmit} />
    </main>
  );
}
```
