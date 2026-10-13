# Keeping the frontend in sync with the backend: generating the API client from OpenAPI

The backend publishes its contract as an OpenAPI document: `../backend/openapi.json`, also served live at
<http://localhost:3001/api-json>. Instead of hand-writing request and response types in the frontend, we
generate them from that document. When the backend changes, we regenerate, and TypeScript then points at
every place in the frontend that no longer matches the contract.

| Package | Role |
|---|---|
| `openapi-typescript` (dev dependency) | Reads `openapi.json` and writes one `.ts` file with the `paths`, `operations` and `components` types. No runtime code. |
| `openapi-fetch` | A tiny wrapper around `fetch` typed by those `paths`: URL, path params, body and response are all checked by the compiler. |

Both are already installed in this repo; steps 1 to 4 are what was done.

## 1. Install

```bash
npm i openapi-fetch
npm i -D openapi-typescript
```

## 2. Add the generation script

In `package.json`:

```json
"scripts": {
  "api:types": "openapi-typescript ../backend/openapi.json -o src/lib/api-types.ts"
}
```

It reads the file the backend commits (`npm run openapi` in `../backend` regenerates it). To read from a
running backend instead, point it at the URL:

```bash
npx openapi-typescript http://localhost:3001/api-json -o src/lib/api-types.ts
```

## 3. Generate

```bash
npm run api:types
```

This writes `src/lib/api-types.ts`. It is generated code: never edit it, regenerate it. The interesting part
is `components.schemas`, one type per schema in the document:

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

Notice that everything the backend declared (step 3 and 4 of `../backend/TODO-API.md`) is here: the enum
from `@IsIn(PRIORITIES)`, optional fields from `?`, the `date-time` format from the `Date` property, the
JSDoc example. `paths` and `operations` describe each route: its path params, request body and the
response type per status code.

## 4. Create the typed client: `src/lib/api.ts`

```ts
import createClient from "openapi-fetch";
import type { components, paths } from "./api-types";

/** A Todo exactly as the backend returns it (generated from openapi.json). */
export type ApiTodo = components["schemas"]["Todo"];

export const api = createClient<paths>({
  baseUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001",
});
```

`createClient<paths>` is the whole client. The generic parameter is what makes every call below type-safe.
`NEXT_PUBLIC_API_URL` lets you point at another backend without touching code (Next exposes `NEXT_PUBLIC_*`
variables to the browser).

## 5. Use it

```ts
import { api } from "@/lib/api";

const { data, error } = await api.GET("/todos");
// data: ApiTodo[] | undefined   error: set on 4xx/5xx

const created = await api.POST("/todos", { body: { name: "Buy milk", priority: "high" } });
// created.data: ApiTodo | undefined

await api.PATCH("/todos/{id}", { params: { path: { id } }, body: { done: true } });
await api.DELETE("/todos/{id}", { params: { path: { id } } });
```

What the compiler now rejects, at build time instead of at runtime:

- `api.GET("/todo")`: unknown path.
- `body: { name: "x", priority: "urgent" }`: not one of the enum values.
- `body: { description: "no name" }`: `name` is required.
- `data[0].id`: the field is `_id`.
- `api.PATCH("/todos/{id}", { body: { done: true } })`: missing path param.

## 6. Keep it in sync

Every time the backend contract changes:

```bash
cd ../backend && npm run openapi      # 1. regenerate openapi.json (needs Mongo running)
cd ../frontend && npm run api:types   # 2. regenerate src/lib/api-types.ts
npx tsc --noEmit                      # 3. the compiler lists every call that no longer matches
```

Commit `openapi.json` and `api-types.ts` together with the change. Renaming `done` to `completed` in the
backend, for example, turns into type errors in the frontend before anything is deployed.

A CI job can enforce that the committed files are fresh: run the two generation commands and fail on
`git diff --exit-code backend/openapi.json frontend/src/lib/api-types.ts`.

## 7. Switch the page from the in-memory array to the API

`src/app/page.tsx` currently keeps the todos in `useState(initialTodos)`. The components (`TodoList`,
`TodoForm`) do not change; only where the data comes from.

Start the backend on another port first (both default to 3000):

```bash
cd ../backend && docker compose up -d && PORT=3001 npm run start:dev
```

### 7.1 Map the API shape to the UI shape

The API returns `_id` and an ISO date-time; the UI type `Todo` uses `id` and a `YYYY-MM-DD` deadline (what
the date input needs). One function converts:

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

### 7.2 Load from the API instead of the array

```tsx
const [todos, setTodos] = useState<Todo[]>([]);

useEffect(() => {
  api.GET("/todos").then(({ data }) => setTodos((data ?? []).map(toTodo)));
}, []);
```

The state starts empty and `useEffect` runs once after the first render to fetch. Delete the
`initialTodos` import (and `src/lib/todos.ts` if nothing else uses it).

### 7.3 Create and update through the API

The `TodoInput` the form produces has the same fields as `CreateTodoDto`, so it is sent as the body as is.
Each call returns the saved todo, which replaces the local copy: the server is the source of truth.

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

New todos go to the front of the list because `GET /todos` returns newest first. `data` is `undefined`
when the request failed; `error` carries the backend's message (for example the validation errors) if you
want to show it.

### Final `src/app/page.tsx`

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
