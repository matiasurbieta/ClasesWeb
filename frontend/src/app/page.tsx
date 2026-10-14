"use client";

import { signIn, signOut, useSession } from "next-auth/react";
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
  const { data: session, status } = useSession();
  const [todos, setTodos] = useState<Todo[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Todo>();

  // Load the todos once the user is signed in (the API answers 401 otherwise).
  useEffect(() => {
    if (status !== "authenticated") return;
    api.GET("/todos").then(({ data }) => setTodos((data ?? []).map(toTodo)));
  }, [status]);

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

  if (status === "loading") return null;

  if (!session) {
    return (
      <main className="mx-auto grid w-full max-w-3xl gap-4 p-8">
        <h1 className="text-2xl font-semibold">Todos</h1>
        <p className="text-muted-foreground">Sign in to see your todos.</p>
        <Button className="w-fit" onClick={() => signIn("auth0")}>
          Sign in with Auth0
        </Button>
      </main>
    );
  }

  return (
    <main className="mx-auto grid w-full max-w-3xl gap-8 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Todos</h1>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{session.user?.email}</span>
          <Button variant="outline" onClick={() => signOut()}>
            Sign out
          </Button>
          <Button onClick={openNew}>New todo</Button>
        </div>
      </div>
      <TodoList todos={todos} onEdit={openEdit} onToggle={handleToggle} />
      <TodoForm open={open} onOpenChange={setOpen} todo={editing} onSubmit={handleSubmit} />
    </main>
  );
}
