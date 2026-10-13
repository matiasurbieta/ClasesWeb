"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PRIORITIES, type Priority, type Todo, type TodoInput } from "@/lib/todo";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When present the form edits this todo; otherwise it creates a new one. */
  todo?: Todo;
  onSubmit: (input: TodoInput) => void;
};

/** Create/edit form shown in a dialog. Calls onSubmit with the values and closes itself. */
export function TodoForm({ open, onOpenChange, todo, onSubmit }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{todo ? "Edit todo" : "New todo"}</DialogTitle>
          <DialogDescription>
            {todo ? "Change the fields and save." : "Fill in the fields and create the todo."}
          </DialogDescription>
        </DialogHeader>
        {/* The fields live in their own component so they remount (fresh values) every time the dialog opens. */}
        <Fields
          todo={todo}
          onSubmit={(input) => {
            onSubmit(input);
            onOpenChange(false);
          }}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

type FieldsProps = Pick<Props, "todo" | "onSubmit"> & { onCancel: () => void };

function Fields({ todo, onSubmit, onCancel }: FieldsProps) {
  const [priority, setPriority] = useState<Priority>(todo?.priority ?? "medium");

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    onSubmit({
      name: String(data.get("name")).trim(),
      description: String(data.get("description") ?? "").trim() || undefined,
      priority,
      deadline: String(data.get("deadline") ?? "") || undefined,
      done: todo?.done ?? false,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" required maxLength={120} defaultValue={todo?.name} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="description">Description</Label>
        <Textarea id="description" name="description" defaultValue={todo?.description} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label htmlFor="priority">Priority</Label>
          <Select value={priority} onValueChange={(v) => v && setPriority(v as Priority)}>
            <SelectTrigger id="priority" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRIORITIES.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="deadline">Deadline</Label>
          <Input id="deadline" name="deadline" type="date" defaultValue={todo?.deadline} />
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">{todo ? "Save" : "Create"}</Button>
      </DialogFooter>
    </form>
  );
}
