export const PRIORITIES = ["low", "medium", "high"] as const;
export type Priority = (typeof PRIORITIES)[number];

export type Todo = {
  id: string;
  name: string;
  description?: string;
  priority: Priority;
  /** ISO date, e.g. "2026-12-31" */
  deadline?: string;
  done: boolean;
};

/** What the form produces: a Todo without the id (the store assigns it). */
export type TodoInput = Omit<Todo, "id">;
