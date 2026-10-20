# App de tareas: agregar la lógica paso a paso

*English version: [TODO-LOGIC.md](TODO-LOGIC.md)*

El proyecto trae **solo la UI**. No se guarda nada y no pasa nada cuando envías el formulario.
Esta guía agrega, en orden: un array de tareas en memoria, el estado que las muestra, la creación, marcar como hecha
y la edición.

| Archivo | Qué es |
|---|---|
| `src/lib/todo.ts` | La entidad `Todo` (`id`, `name`, `description`, `priority`, `deadline`, `done`) y `TodoInput` (un `Todo` sin `id`). |
| `src/components/todo-list.tsx` | Tabla que renderiza un `Todo[]`. Acepta los callbacks opcionales `onEdit` y `onToggle`. |
| `src/components/todo-form.tsx` | Formulario de creación/edición dentro de un diálogo (popup). Se controla con `open` / `onOpenChange`. Llama a `onSubmit(input: TodoInput)` y luego se cierra solo. Cuando recibe una prop `todo` funciona en modo edición. |
| `src/app/page.tsx` | La página. Por ahora renderiza una lista vacía, un botón **New todo** que abre el diálogo y un submit que solo escribe en la consola. |

Ejecútalo:

```bash
npm install
npm run dev     # http://localhost:3000
```

Abre la consola del navegador, haz clic en **New todo**, completa el formulario y presiona **Create**: el diálogo se cierra
y verás el objeto `TodoInput` impreso en la consola. Ese objeto es lo que vamos a guardar.

## Paso 1: un array de tareas en memoria

Crea `src/lib/todos.ts`. Por ahora este array cumple el papel de la base de datos.

```ts
// src/lib/todos.ts
import type { Todo } from "./todo";

export const initialTodos: Todo[] = [
  { id: "1", name: "Read the Next.js docs", priority: "high", deadline: "2026-10-20", done: false },
  { id: "2", name: "Install shadcn/ui", description: "npx shadcn@latest init", priority: "medium", done: true },
  { id: "3", name: "Buy coffee", priority: "low", done: false },
];
```

## Paso 2: tomar las tareas del array y mostrarlas

Abre `src/app/page.tsx`. Ya empieza con `"use client"` (la página se ejecuta en el navegador porque tiene estado y pasa
callbacks) y ya tiene un estado: `open`, que le indica al diálogo si está visible.

Importa el array y agrega un segundo estado para las tareas; luego reemplaza `todos={[]}`:

```tsx
"use client";

import { useState } from "react";
import { TodoForm } from "@/components/todo-form";
import { TodoList } from "@/components/todo-list";
import { Button } from "@/components/ui/button";
import { initialTodos } from "@/lib/todos";

export default function Home() {
  const [todos, setTodos] = useState(initialTodos);
  const [open, setOpen] = useState(false);

  return (
    <main className="mx-auto grid w-full max-w-3xl gap-8 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Todos</h1>
        <Button onClick={() => setOpen(true)}>New todo</Button>
      </div>
      <TodoList todos={todos} />
      <TodoForm
        open={open}
        onOpenChange={setOpen}
        onSubmit={(input) => console.log("submitted", input)}
      />
    </main>
  );
}
```

`useState(initialTodos)` copia el array al estado de React en el primer render. `todos` es lo que muestra la lista y
`setTodos` es la única forma de cambiarlo. Recarga: las tres tareas aparecen en la tabla.

## Paso 3: habilitar la creación

El formulario nos entrega un `TodoInput` (cada campo excepto `id`). Para crear una tarea armamos el `Todo` completo y lo
agregamos al estado **sin mutar** el array anterior:

```tsx
import type { TodoInput } from "@/lib/todo";

function handleCreate(input: TodoInput) {
  setTodos((prev) => [...prev, { id: crypto.randomUUID(), ...input }]);
}
```

Conéctalo al formulario:

```tsx
<TodoForm open={open} onOpenChange={setOpen} onSubmit={handleCreate} />
```

Dos cosas a notar:

- `setTodos((prev) => ...)` recibe el estado más reciente. `setTodos([...todos, ...])` también funcionaría aquí, pero la
  forma funcional es el hábito seguro cuando el valor nuevo depende del anterior.
- `[...prev, newTodo]` crea un **array nuevo**. `prev.push(newTodo)` mantendría la misma referencia al array, React no
  vería un cambio y la tabla no se volvería a renderizar.

Pruébalo: haz clic en **New todo**, completa el formulario y presiona **Create**. El diálogo se cierra (el formulario
llama a `onOpenChange(false)` después de `onSubmit`) y aparece la fila nueva.

## Paso 4: marcar como hecha

La lista llama a `onToggle(todo)` cuando cambia el checkbox. Reemplaza solo esa tarea por una copia con `done`
invertido:

```tsx
import type { Todo, TodoInput } from "@/lib/todo";

function handleToggle(todo: Todo) {
  setTodos((prev) => prev.map((t) => (t.id === todo.id ? { ...t, done: !t.done } : t)));
}
```

```tsx
<TodoList todos={todos} onToggle={handleToggle} />
```

## Paso 5: editar una tarea existente

Lleva registro de qué tarea se está editando y abre el diálogo con ella. El mismo formulario resuelve ambos casos:
cuando `editing` tiene un valor reemplazamos esa tarea; si no, la agregamos al final.

```tsx
const [editing, setEditing] = useState<Todo>();

function openNew() {
  setEditing(undefined);
  setOpen(true);
}

function openEdit(todo: Todo) {
  setEditing(todo);
  setOpen(true);
}

function handleSubmit(input: TodoInput) {
  if (editing) {
    setTodos((prev) => prev.map((t) => (t.id === editing.id ? { ...t, ...input } : t)));
  } else {
    setTodos((prev) => [...prev, { id: crypto.randomUUID(), ...input }]);
  }
}
```

```tsx
<Button onClick={openNew}>New todo</Button>
<TodoList todos={todos} onEdit={openEdit} onToggle={handleToggle} />
<TodoForm open={open} onOpenChange={setOpen} todo={editing} onSubmit={handleSubmit} />
```

¿Por qué los campos muestran los valores correctos sin ningún código que los reinicie? El diálogo desmonta su contenido
cuando se cierra, así que cada vez que se abre el formulario se monta de cero y lee sus valores iniciales de `todo` (los
inputs usan `defaultValue`). Por eso también `openNew` limpia `editing` antes de abrir: si no, el formulario mostraría
la última tarea editada.

## `src/app/page.tsx` final

```tsx
// src/app/page.tsx
"use client";

import { useState } from "react";
import { TodoForm } from "@/components/todo-form";
import { TodoList } from "@/components/todo-list";
import { Button } from "@/components/ui/button";
import type { Todo, TodoInput } from "@/lib/todo";
import { initialTodos } from "@/lib/todos";

export default function Home() {
  const [todos, setTodos] = useState(initialTodos);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Todo>();

  function openNew() {
    setEditing(undefined);
    setOpen(true);
  }

  function openEdit(todo: Todo) {
    setEditing(todo);
    setOpen(true);
  }

  function handleSubmit(input: TodoInput) {
    if (editing) {
      setTodos((prev) => prev.map((t) => (t.id === editing.id ? { ...t, ...input } : t)));
    } else {
      setTodos((prev) => [...prev, { id: crypto.randomUUID(), ...input }]);
    }
  }

  function handleToggle(todo: Todo) {
    setTodos((prev) => prev.map((t) => (t.id === todo.id ? { ...t, done: !t.done } : t)));
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

## Hacia dónde seguir

El estado vive en la página, así que al recargar se pierde todo. El siguiente paso es reemplazar `initialTodos` por la
API REST de `../backend` (mira su `TODO-API.es.md`):

- carga con `fetch("http://localhost:3001/todos")` dentro de un `useEffect`,
- crea con `fetch(url, { method: "POST", body: JSON.stringify(input) })`,
- el backend devuelve `_id` en lugar de `id`, así que conviértelo al leer.

Ambos proyectos usan el puerto 3000 por defecto, así que inicia el backend con `PORT=3001 npm run start:dev`.
