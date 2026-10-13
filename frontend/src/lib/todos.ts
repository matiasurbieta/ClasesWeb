import type { Todo } from "./todo";

export const initialTodos: Todo[] = [
  { id: "1", name: "Read the Next.js docs", priority: "high", deadline: "2026-10-20", done: false },
  { id: "2", name: "Install shadcn/ui", description: "npx shadcn@latest init", priority: "medium", done: true },
  { id: "3", name: "Buy coffee", priority: "low", done: false },
];
