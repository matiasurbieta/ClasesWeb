"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Priority, Todo } from "@/lib/todo";

const priorityVariant: Record<Priority, "secondary" | "default" | "destructive"> = {
  low: "secondary",
  medium: "default",
  high: "destructive",
};

type Props = {
  todos: Todo[];
  onEdit?: (todo: Todo) => void;
  onToggle?: (todo: Todo) => void;
};

export function TodoList({ todos, onEdit, onToggle }: Props) {
  if (todos.length === 0) {
    return <p className="text-sm text-muted-foreground">No todos yet.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Priority</TableHead>
          <TableHead>Deadline</TableHead>
          <TableHead>Done</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {todos.map((todo) => (
          <TableRow key={todo.id} className={todo.done ? "line-through opacity-60" : ""}>
            <TableCell>
              <div className="font-medium">{todo.name}</div>
              {todo.description && (
                <div className="text-xs text-muted-foreground">{todo.description}</div>
              )}
            </TableCell>
            <TableCell>
              <Badge variant={priorityVariant[todo.priority]}>{todo.priority}</Badge>
            </TableCell>
            <TableCell>{todo.deadline ?? "—"}</TableCell>
            <TableCell>
              <input
                type="checkbox"
                aria-label={`Mark ${todo.name} as done`}
                checked={todo.done}
                onChange={() => onToggle?.(todo)}
              />
            </TableCell>
            <TableCell className="text-right">
              <Button variant="outline" size="sm" onClick={() => onEdit?.(todo)}>
                Edit
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
