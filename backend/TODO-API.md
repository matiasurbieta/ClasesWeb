# Todos API: registering the entity and exposing it, step by step

*Versión en español: [TODO-API.es.md](TODO-API.es.md)*

Stack: NestJS 12, MongoDB via Mongoose 9 (`@nestjs/mongoose`), Swagger/OpenAPI (`@nestjs/swagger` plus its
CLI plugin, so the document is generated from the TypeScript types), input validation with `class-validator`.

## 0. Run it

```bash
docker compose up -d      # MongoDB 8 on localhost:27017 (data kept in a named volume)
npm install
npm run start:dev         # http://localhost:3000
```

- Swagger UI: <http://localhost:3000/api>
- OpenAPI JSON: <http://localhost:3000/api-json>
- `npm run openapi` writes that same document to `openapi.json` (needs Mongo running, the app boots fully).

The connection string defaults to `mongodb://localhost:27017/todos`. Override it with
`MONGO_URI=mongodb://host:27017/other npm run start:dev`.

## 1. Install the libraries (already done in this repo)

```bash
npm i @nestjs/mongoose mongoose @nestjs/swagger class-validator class-transformer
```

| Package | Role |
|---|---|
| `mongoose` | MongoDB ODM: schemas, models, queries. |
| `@nestjs/mongoose` | Nest integration: `MongooseModule`, `@Schema`/`@Prop` decorators, `@InjectModel`. |
| `@nestjs/swagger` | Builds the OpenAPI document and serves Swagger UI. Its CLI plugin (step 8) reads the TypeScript types so the classes need no Swagger decorators. |
| `class-validator` + `class-transformer` | Used by Nest's `ValidationPipe` to validate request bodies against the DTO classes. |

## 2. Connect to MongoDB: `src/app.module.ts`

```ts
import { MongooseModule } from '@nestjs/mongoose';
import { TodosModule } from './todos/todos.module.js';

@Module({
  imports: [
    MongooseModule.forRoot(process.env.MONGO_URI ?? 'mongodb://localhost:27017/todos'),
    TodosModule,
  ],
  ...
})
export class AppModule {}
```

`forRoot` opens one connection shared by every feature module. Nest waits for it before the app starts
listening, so if Mongo is down the boot fails (after Mongoose's 30 s server-selection timeout).

> This project uses ES modules (`"type": "module"` in `package.json`), which is why local imports end in
> `.js` even though the source files are `.ts`.

## 3. Define the entity: `src/todos/todo.schema.ts`

```ts
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

  createdAt: Date;
  updatedAt: Date;
}

export type TodoDocument = HydratedDocument<Todo>;
export const TodoSchema = SchemaFactory.createForClass(Todo);
```

How to read it:

- `@Schema()` marks the class as a Mongoose schema. The collection name is derived from the class name:
  `Todo` → `todos`. `timestamps: true` adds `createdAt`/`updatedAt` automatically; `versionKey: false`
  drops the `__v` field from documents.
- `@Prop()` declares a persisted field. Options map 1:1 to Mongoose schema options (`required`, `enum`,
  `default`, `maxlength`, ...). The TypeScript type is read through decorator metadata; for unions or
  enums give the type explicitly (`type: String`).
- `_id`, `createdAt` and `updatedAt` have **no** `@Prop`: Mongo creates them. They are declared anyway so
  the class describes the full shape of a document, which is what the API returns and what the Swagger
  plugin documents.
- `SchemaFactory.createForClass(Todo)` turns the decorated class into the actual Mongoose schema object.
- `HydratedDocument<Todo>` is the type of a document returned by queries (the entity plus Mongoose helpers).

## 4. Validate the input: DTOs

`src/todos/dto/create-todo.dto.ts`

```ts
import { IsBoolean, IsDateString, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { PRIORITIES, type Priority } from '../todo.schema.js';

export class CreateTodoDto {
  /** @example Buy milk */
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(PRIORITIES)
  priority?: Priority;

  /** ISO date @example 2026-12-31 */
  @IsOptional()
  @IsDateString()
  deadline?: string;

  @IsOptional()
  @IsBoolean()
  done?: boolean;
}
```

`src/todos/dto/update-todo.dto.ts`

```ts
import { PartialType } from '@nestjs/swagger';
import { CreateTodoDto } from './create-todo.dto.js';

export class UpdateTodoDto extends PartialType(CreateTodoDto) {}
```

- The entity describes what is **stored**; the DTO describes what the client is allowed to **send**.
  That is why `_id`, `createdAt`, `updatedAt` are not in the DTO.
- The `class-validator` decorators (`@IsString`, `@IsIn`, `@MaxLength`...) enforce the rules at runtime.
  The Swagger plugin reuses them for the document: `@IsIn(PRIORITIES)` becomes an `enum`, `@MaxLength(120)`
  becomes `maxLength`, and `?` marks a field as optional.
- A JSDoc comment becomes the field description and `@example` its example in Swagger UI.
- `PartialType` makes every field optional **and keeps both the validation and the Swagger metadata**.
  Import it from `@nestjs/swagger`, not from `@nestjs/mapped-types`, or the Swagger metadata is lost.
- The rules only run because `main.ts` registers the pipe globally:

```ts
app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
```

`whitelist` silently strips any property that is not declared in the DTO. `transform` converts the plain
JSON body into a real `CreateTodoDto` instance (and path params to their declared types).

## 5. Service: `src/todos/todos.service.ts`

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CreateTodoDto } from './dto/create-todo.dto.js';
import { UpdateTodoDto } from './dto/update-todo.dto.js';
import { Todo } from './todo.schema.js';

@Injectable()
export class TodosService {
  constructor(@InjectModel(Todo.name) private readonly model: Model<Todo>) {}

  create(dto: CreateTodoDto) {
    return this.model.create(dto);
  }

  findAll() {
    return this.model.find().sort({ createdAt: -1 }).exec();
  }

  async findOne(id: string) {
    const todo = await this.model.findById(id).exec();
    if (!todo) throw new NotFoundException(`Todo ${id} not found`);
    return todo;
  }

  async update(id: string, dto: UpdateTodoDto) {
    const todo = await this.model
      .findByIdAndUpdate(id, dto, { returnDocument: 'after', runValidators: true })
      .exec();
    if (!todo) throw new NotFoundException(`Todo ${id} not found`);
    return todo;
  }

  async remove(id: string) {
    const todo = await this.model.findByIdAndDelete(id).exec();
    if (!todo) throw new NotFoundException(`Todo ${id} not found`);
  }
}
```

- `@InjectModel(Todo.name)` asks Nest for the Mongoose model registered under the name `"Todo"`
  (see step 7). `Model<Todo>` is the typed query API: `create`, `find`, `findById`, ...
- `returnDocument: 'after'` makes `findByIdAndUpdate` return the updated document instead of the old one;
  `runValidators` applies the schema rules (`enum`, `maxlength`) on update too.
- Throwing `NotFoundException` is how a service says "404"; Nest turns it into the HTTP response.

## 6. Controller: `src/todos/todos.controller.ts`

```ts
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ParseObjectIdPipe } from '@nestjs/mongoose';
import { ApiTags } from '@nestjs/swagger';
import { CreateTodoDto } from './dto/create-todo.dto.js';
import { UpdateTodoDto } from './dto/update-todo.dto.js';
import { Todo } from './todo.schema.js';
import { TodosService } from './todos.service.js';

@ApiTags('todos')
@Controller('todos')
export class TodosController {
  constructor(private readonly todos: TodosService) {}

  @Post()
  create(@Body() dto: CreateTodoDto): Promise<Todo> {
    return this.todos.create(dto);
  }

  @Get()
  findAll(): Promise<Todo[]> {
    return this.todos.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseObjectIdPipe) id: string): Promise<Todo> {
    return this.todos.findOne(id);
  }

  @Patch(':id')
  update(@Param('id', ParseObjectIdPipe) id: string, @Body() dto: UpdateTodoDto): Promise<Todo> {
    return this.todos.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseObjectIdPipe) id: string): Promise<void> {
    return this.todos.remove(id);
  }
}
```

Resulting API:

| Method | Path | Body | Response |
|---|---|---|---|
| `POST` | `/todos` | `CreateTodoDto` | `201` Todo, `400` validation error |
| `GET` | `/todos` | | `200` Todo[] (newest first) |
| `GET` | `/todos/:id` | | `200` Todo, `400` bad id, `404` |
| `PATCH` | `/todos/:id` | `UpdateTodoDto` | `200` Todo, `400`, `404` |
| `DELETE` | `/todos/:id` | | `204`, `400`, `404` |

- `@Controller('todos')` is the route prefix; `@Get(':id')` etc. add the rest.
- `@Body() dto: CreateTodoDto` is where the `ValidationPipe` kicks in: the class on the parameter decides
  which rules run, and the Swagger plugin uses it as the request schema.
- The explicit return types (`Promise<Todo>`, `Promise<Todo[]>`, `Promise<void>`) are what the plugin
  turns into the response schemas, together with the status from the verb (`201` for `POST`, `200`
  otherwise) or from `@HttpCode`.
- `ParseObjectIdPipe` (from `@nestjs/mongoose`) rejects ids that are not valid Mongo ObjectIds with `400`
  instead of letting Mongoose throw a cast error (`500`).
- `@ApiTags('todos')` is the only Swagger decorator left; it just groups the routes in the UI. The error
  responses in the table above are real behaviour but are not in the document; add
  `@ApiNotFoundResponse()` / `@ApiBadRequestResponse()` on a route if you want them listed.

## 7. Register everything: `src/todos/todos.module.ts`

```ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Todo, TodoSchema } from './todo.schema.js';
import { TodosController } from './todos.controller.js';
import { TodosService } from './todos.service.js';

@Module({
  imports: [MongooseModule.forFeature([{ name: Todo.name, schema: TodoSchema }])],
  controllers: [TodosController],
  providers: [TodosService],
})
export class TodosModule {}
```

`MongooseModule.forFeature` creates the model (`"Todo"` + `TodoSchema` on the shared connection) and makes
it injectable inside this module, which is what `@InjectModel(Todo.name)` resolves to. Finally the module
is listed in `AppModule.imports` (step 2) so Nest mounts its controller.

## 8. Swagger and the OpenAPI document

### The CLI plugin does the annotating

Without help, `@nestjs/swagger` only sees what decorators tell it: every DTO and entity field would need an
`@ApiProperty()` / `@ApiPropertyOptional()` and every route an `@ApiOkResponse({ type })`. The CLI plugin
removes that duplication: it runs inside `nest build` / `nest start`, reads the TypeScript types and
emits the same metadata at compile time. It is enabled in `nest-cli.json`:

```json
"compilerOptions": {
  "plugins": [
    {
      "name": "@nestjs/swagger",
      "options": {
        "esmCompatible": true,
        "classValidatorShim": true,
        "introspectComments": true,
        "dtoFileNameSuffix": [".dto.ts", ".schema.ts"]
      }
    }
  ]
}
```

| Option | Effect |
|---|---|
| `dtoFileNameSuffix` | Which files hold model classes to annotate. The default is `.dto.ts` and `.entity.ts`; `.schema.ts` is added so the Mongoose entity is documented too. |
| `classValidatorShim` | Reuses `class-validator` decorators: `@IsIn` → `enum`, `@MaxLength` → `maxLength`, `@Min`/`@Max`, `@Length`, `@Matches`... |
| `introspectComments` | JSDoc comment → `description`, `@example` tag → `example`. |
| `esmCompatible` | Required because this project is ES modules. |

What it infers on its own: `string`/`number`/`boolean`/`Date` → OpenAPI type and format (`Date` becomes
`string` + `date-time`), `?` → optional (everything else is `required`), a union of string literals →
`enum`, arrays, nested classes, and on controllers the response schema from each method's return type and
the status from the verb or `@HttpCode`.

Two things it cannot see: Mongoose options such as `maxlength` in `@Prop(...)`, and error responses. If
you need those in the document, add the explicit decorator (`@ApiProperty({ maxLength: 120 })`,
`@ApiNotFoundResponse()`) on just that field or route; explicit decorators always win over the plugin.

The plugin is part of the Nest compiler, so code run by other tools (for example `vitest`) does not get
the metadata. That only matters if a test inspects the OpenAPI document.

### Serving and exporting the document

`src/swagger.ts` builds the document once, shared by the server and by the generator script:

```ts
import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function createOpenApiDocument(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('Todos API')
    .setDescription('CRUD API for the Todo entity, persisted in MongoDB')
    .setVersion('1.0')
    .build();
  return SwaggerModule.createDocument(app, config);
}
```

`src/main.ts` serves it:

```ts
// Swagger UI at /api, raw OpenAPI JSON at /api-json
SwaggerModule.setup('api', app, createOpenApiDocument(app));
```

`src/openapi.ts` writes it to disk (`npm run openapi` = `nest build && node dist/openapi`):

```ts
const app = await NestFactory.create(AppModule, { logger: false });
writeFileSync('openapi.json', JSON.stringify(createOpenApiDocument(app), null, 2) + '\n');
await app.close();
```

`SwaggerModule.createDocument` scans every controller and collects routes, request schemas (the `@Body()`
classes), response schemas (the return types) and the per-field metadata the plugin emitted. The result
is the `components.schemas` section with `Todo`, `CreateTodoDto` and `UpdateTodoDto`, which is what tools
such as code generators consume.

## 9. Try it

```bash
# create
curl -s -X POST localhost:3000/todos -H 'content-type: application/json' \
  -d '{"name":"Buy milk","priority":"high","deadline":"2026-12-31"}'
# {"name":"Buy milk","priority":"high","deadline":"2026-12-31T00:00:00.000Z","done":false,"_id":"6ace9d2f...","createdAt":"...","updatedAt":"..."}

# list
curl -s localhost:3000/todos

# update (use the _id from the create response)
curl -s -X PATCH localhost:3000/todos/<id> -H 'content-type: application/json' -d '{"done":true}'

# validation error -> 400
curl -s -X POST localhost:3000/todos -H 'content-type: application/json' -d '{"priority":"urgent"}'
# {"message":["name should not be empty", ..., "priority must be one of the following values: low, medium, high"],"error":"Bad Request","statusCode":400}

# delete -> 204, then 404
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE localhost:3000/todos/<id>
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/todos/<id>
```

## Adding another entity

Repeat steps 3 to 7 in a new folder under `src/`. The Nest CLI generates the skeleton:

```bash
npx nest g resource projects     # choose "REST API"
```

then replace the generated entity with a `@Schema` class, add `MongooseModule.forFeature` to the new
module, and inject the model in the service. Name the files `*.schema.ts` and `*.dto.ts` and the Swagger
plugin picks them up with no extra decorators.
