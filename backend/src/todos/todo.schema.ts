import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

export const PRIORITIES = ['low', 'medium', 'high'] as const;
export type Priority = (typeof PRIORITIES)[number];

@Schema({ timestamps: true, versionKey: false })
export class Todo {
  _id: string;

  @Prop({ required: true, trim: true, maxlength: 120 })
  name: string;

  @Prop()
  description?: string;

  @Prop({ type: String, enum: PRIORITIES, default: 'medium' })
  priority: Priority;

  @Prop()
  deadline?: Date;

  @Prop({ default: false })
  done: boolean;

  /** Identity provider user id (`sub` claim). Set by the server from the token, not by the client. */
  @Prop({ required: true, index: true })
  owner: string;

  createdAt: Date;
  updatedAt: Date;
}

export type TodoDocument = HydratedDocument<Todo>;
export const TodoSchema = SchemaFactory.createForClass(Todo);
