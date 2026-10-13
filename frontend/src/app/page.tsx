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
