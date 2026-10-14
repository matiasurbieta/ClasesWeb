import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ParseObjectIdPipe } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthUser } from '../auth/jwt.strategy.js';
import { CreateTodoDto } from './dto/create-todo.dto.js';
import { UpdateTodoDto } from './dto/update-todo.dto.js';
import { Todo } from './todo.schema.js';
import { TodosService } from './todos.service.js';

@ApiTags('todos')
@ApiBearerAuth()
@Controller('todos')
export class TodosController {
  constructor(private readonly todos: TodosService) {}

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateTodoDto,
  ): Promise<Todo> {
    return this.todos.create(user.id, dto);
  }

  @Get()
  findAll(@CurrentUser() user: AuthUser): Promise<Todo[]> {
    return this.todos.findAll(user.id);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<Todo> {
    return this.todos.findOne(user.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateTodoDto,
  ): Promise<Todo> {
    return this.todos.update(user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<void> {
    return this.todos.remove(user.id, id);
  }
}
