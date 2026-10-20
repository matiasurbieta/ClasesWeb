import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CreateTodoDto } from './dto/create-todo.dto.js';
import { UpdateTodoDto } from './dto/update-todo.dto.js';
import { Todo } from './todo.schema.js';

// Every query includes the owner, so a user can never read or change someone else's todo.
// Someone else's id answers 404, not 403: the API does not reveal that the id exists.
@Injectable()
export class TodosService {
  constructor(@InjectModel(Todo.name) private readonly model: Model<Todo>) {}

  create(owner: string, dto: CreateTodoDto) {
    // oxlint-disable-next-line typescript/no-misused-spread -- the DTO is plain data
    return this.model.create({ ...dto, owner });
  }

  findAll(owner: string) {
    return this.model.find({ owner }).sort({ createdAt: -1 }).exec();
  }

  async findOne(owner: string, id: string) {
    const todo = await this.model.findOne({ _id: id, owner }).exec();
    if (!todo) throw new NotFoundException(`Todo ${id} not found`);
    return todo;
  }

  async update(owner: string, id: string, dto: UpdateTodoDto) {
    const todo = await this.model
      .findOneAndUpdate({ _id: id, owner }, dto, {
        returnDocument: 'after',
        runValidators: true,
      })
      .exec();
    if (!todo) throw new NotFoundException(`Todo ${id} not found`);
    return todo;
  }

  async remove(owner: string, id: string) {
    const todo = await this.model.findOneAndDelete({ _id: id, owner }).exec();
    if (!todo) throw new NotFoundException(`Todo ${id} not found`);
  }
}
