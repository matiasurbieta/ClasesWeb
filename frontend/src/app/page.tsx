"use client";

import { useState } from "react";
import { TodoForm } from "@/components/todo-form";
import { TodoList } from "@/components/todo-list";
import { Button } from "@/components/ui/button";

// Starting point: no data and no todo state yet. Follow TODO-LOGIC.md to add them.
export default function Home() {
  const [open, setOpen] = useState(false);

  return (
    <main className="mx-auto grid w-full max-w-3xl gap-8 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Todos</h1>
        <Button onClick={() => setOpen(true)}>New todo</Button>
      </div>
      <TodoList todos={[]} />
      <TodoForm
        open={open}
        onOpenChange={setOpen}
        onSubmit={(input) => console.log("submitted", input)}
      />
    </main>
  );
}
