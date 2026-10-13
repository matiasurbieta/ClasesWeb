# Todo app: adding the logic step by step

> **Branch note:** `main` already contains the result of every step below (`src/lib/todos.ts` and the final
> `src/app/page.tsx`). To follow the guide yourself start from the `initial` branch: `git checkout initial`.

The project ships the **UI only**. Nothing is stored and nothing happens when you submit the form.
This guide adds, in order: an in-memory array of todos, the state that shows them, creation, toggling
and editing.

| File | What it is |
|---|---|
| `src/lib/todo.ts` | The `Todo` entity (`id`, `name`, `description`, `priority`, `deadline`, `done`) and `TodoInput` (a `Todo` without `id`). |
| `src/components/todo-list.tsx` | Table that renders a `Todo[]`. Accepts optional `onEdit` and `onToggle` callbacks. |
| `src/components/todo-form.tsx` | Create/edit form inside a dialog (popup). Controlled with `open` / `onOpenChange`. Calls `onSubmit(input: TodoInput)` and then closes itself. When it receives a `todo` prop it works in edit mode. |
| `src/app/page.tsx` | The page. Right now it renders an empty list, a **New todo** button that opens the dialog, and a submit that only logs to the console. |

Run it:

```bash
npm install
npm run dev     # http://localhost:3000
```

Open the browser console, click **New todo**, fill the form and press **Create**: the dialog closes and
you will see the `TodoInput` object logged. That object is what we will store.

## Step 1: an in-memory array of todos

Create `src/lib/todos.ts`. For now this array plays the role of the database.

```ts
// src/lib/todos.ts
import type { Todo } from "./todo";

export const initialTodos: Todo[] = [
  { id: "1", name: "Read the Next.js docs", priority: "high", deadline: "2026-10-20", done: false },
  { id: "2", name: "Install shadcn/ui", description: "npx shadcn@latest init", priority: "medium", done: true },
  { id: "3", name: "Buy coffee", priority: "low", done: false },
];
```

## Step 2: pick the todos from the array and show them

Open `src/app/page.tsx`. It already starts with `"use client"` (the page runs in the browser because it
holds state and passes callbacks) and already has one piece of state: `open`, which tells the dialog
whether it is visible.

Import the array and add a second state for the todos, then replace `todos={[]}`:

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

`useState(initialTodos)` copies the array into React state on the first render. `todos` is what the list
shows and `setTodos` is the only way to change it. Reload: the three todos appear in the table.

## Step 3: enable creation

The form hands us a `TodoInput` (everything except `id`). To create a todo we build the full `Todo`
and append it to the state **without mutating** the previous array:

```tsx
import type { TodoInput } from "@/lib/todo";

function handleCreate(input: TodoInput) {
  setTodos((prev) => [...prev, { id: crypto.randomUUID(), ...input }]);
}
```

Wire it to the form:

```tsx
<TodoForm open={open} onOpenChange={setOpen} onSubmit={handleCreate} />
```

Two things to notice:

- `setTodos((prev) => ...)` receives the latest state. `setTodos([...todos, ...])` would also work here,
  but the functional form is the safe habit when the new value depends on the old one.
- `[...prev, newTodo]` creates a **new array**. `prev.push(newTodo)` would keep the same array reference,
  React would not see a change and the table would not re-render.

Try it: click **New todo**, fill the form, press **Create**. The dialog closes (the form calls
`onOpenChange(false)` after `onSubmit`) and the new row appears.

## Step 4: toggle done

The list calls `onToggle(todo)` when the checkbox changes. Replace just that todo with a copy that has
`done` flipped:

```tsx
import type { Todo, TodoInput } from "@/lib/todo";

function handleToggle(todo: Todo) {
  setTodos((prev) => prev.map((t) => (t.id === todo.id ? { ...t, done: !t.done } : t)));
}
```

```tsx
<TodoList todos={todos} onToggle={handleToggle} />
```

## Step 5: edit an existing todo

Keep track of which todo is being edited and open the dialog with it. The same form handles both cases:
when `editing` is set we replace that todo, otherwise we append.

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

Why do the fields show the right values without any reset code? The dialog unmounts its content when it
closes, so every time it opens the form mounts fresh and reads its initial values from `todo` (the
inputs use `defaultValue`). That is also why `openNew` clears `editing` before opening: otherwise the
form would show the last edited todo.

## Final `src/app/page.tsx`

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

## Where to go next

The state lives in the page, so a reload loses everything. The next step is replacing `initialTodos` with
the REST API in `../backend` (see its `TODO-API.md`):

- load with `fetch("http://localhost:3001/todos")` inside a `useEffect`,
- create with `fetch(url, { method: "POST", body: JSON.stringify(input) })`,
- the backend returns `_id` instead of `id`, so map it when reading.

Both projects default to port 3000, so start the backend with `PORT=3001 npm run start:dev`.
