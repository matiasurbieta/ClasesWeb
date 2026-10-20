# API de tareas (Todos API): registrar la entidad y exponerla, paso a paso

*English version: [TODO-API.md](TODO-API.md)*

Stack: NestJS 12, MongoDB mediante Mongoose 9 (`@nestjs/mongoose`), Swagger/OpenAPI (`@nestjs/swagger` más su
plugin de CLI, así el documento se genera a partir de los tipos de TypeScript), validación de la entrada con
`class-validator`.

## 0. Ejecútala

```bash
docker compose up -d      # MongoDB 8 on localhost:27017 (data kept in a named volume)
npm install
npm run start:dev         # http://localhost:3000
```

- Swagger UI: <http://localhost:3000/api>
- OpenAPI JSON: <http://localhost:3000/api-json>
- `npm run openapi` escribe ese mismo documento en `openapi.json` (necesita Mongo en ejecución, porque la app
  arranca por completo).

La cadena de conexión por defecto es `mongodb://localhost:27017/todos`. Puedes sobrescribirla con
`MONGO_URI=mongodb://host:27017/other npm run start:dev`.

## 1. Instala las librerías (ya está hecho en este repo)

```bash
npm i @nestjs/mongoose mongoose @nestjs/swagger class-validator class-transformer
```

| Paquete | Rol |
|---|---|
| `mongoose` | ODM de MongoDB: schemas, modelos, consultas. |
| `@nestjs/mongoose` | Integración con Nest: `MongooseModule`, decoradores `@Schema`/`@Prop`, `@InjectModel`. |
| `@nestjs/swagger` | Construye el documento OpenAPI y sirve Swagger UI. Su plugin de CLI (paso 8) lee los tipos de TypeScript, así que las clases no necesitan decoradores de Swagger. |
| `class-validator` + `class-transformer` | Los usa el `ValidationPipe` de Nest para validar los cuerpos de las peticiones contra las clases DTO. |

## 2. Conéctate a MongoDB: `src/app.module.ts`

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

`forRoot` abre una única conexión compartida por cada módulo de funcionalidad. Nest la espera antes de
que la app empiece a escuchar, así que si Mongo está caído el arranque falla (tras el timeout de selección de
servidor de 30 s de Mongoose).

> Este proyecto usa módulos ES (`"type": "module"` en `package.json`), por eso los imports locales terminan en
> `.js` aunque los archivos fuente sean `.ts`.

## 3. Define la entidad: `src/todos/todo.schema.ts`

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

Cómo leerlo:

- `@Schema()` marca la clase como un schema de Mongoose. El nombre de la colección se deriva del nombre de la
  clase: `Todo` → `todos`. `timestamps: true` agrega `createdAt`/`updatedAt` automáticamente; `versionKey: false`
  quita el campo `__v` de los documentos.
- `@Prop()` declara un campo persistido. Las opciones se corresponden 1:1 con las opciones de schema de Mongoose
  (`required`, `enum`, `default`, `maxlength`, ...). El tipo de TypeScript se lee a través de los metadatos de
  los decoradores; para uniones o enums indica el tipo explícitamente (`type: String`).
- `_id`, `createdAt` y `updatedAt` **no** tienen `@Prop`: los crea Mongo. Se declaran igualmente para que la
  clase describa la forma completa de un documento, que es lo que devuelve la API y lo que documenta el plugin
  de Swagger.
- `SchemaFactory.createForClass(Todo)` convierte la clase decorada en el objeto schema real de Mongoose.
- `HydratedDocument<Todo>` es el tipo de un documento devuelto por las consultas (la entidad más los helpers de
  Mongoose).

## 4. Valida la entrada: DTOs

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

- La entidad describe lo que se **almacena**; el DTO describe lo que el cliente tiene permitido **enviar**.
  Por eso `_id`, `createdAt`, `updatedAt` no están en el DTO.
- Los decoradores de `class-validator` (`@IsString`, `@IsIn`, `@MaxLength`...) aplican las reglas en tiempo de
  ejecución. El plugin de Swagger los reutiliza para el documento: `@IsIn(PRIORITIES)` se convierte en un `enum`,
  `@MaxLength(120)` en `maxLength`, y `?` marca un campo como opcional.
- Un comentario JSDoc se convierte en la descripción del campo y `@example` en su ejemplo en Swagger UI.
- `PartialType` hace opcional cada campo **y conserva tanto la validación como los metadatos de
  Swagger**. Impórtalo desde `@nestjs/swagger`, no desde `@nestjs/mapped-types`, o se pierden los metadatos de
  Swagger.
- Las reglas solo se ejecutan porque `main.ts` registra el pipe globalmente:

```ts
app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
```

`whitelist` elimina silenciosamente cualquier propiedad que no esté declarada en el DTO. `transform` convierte
el cuerpo JSON plano en una instancia real de `CreateTodoDto` (y los parámetros de ruta a sus tipos declarados).

## 5. Servicio: `src/todos/todos.service.ts`

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

- `@InjectModel(Todo.name)` le pide a Nest el modelo de Mongoose registrado con el nombre `"Todo"`
  (ver paso 7). `Model<Todo>` es la API de consultas tipada: `create`, `find`, `findById`, ...
- `returnDocument: 'after'` hace que `findByIdAndUpdate` devuelva el documento actualizado en lugar del
  anterior; `runValidators` aplica las reglas del schema (`enum`, `maxlength`) también al actualizar.
- Lanzar `NotFoundException` es la forma en que un servicio dice "404"; Nest lo convierte en la respuesta HTTP.

## 6. Controlador: `src/todos/todos.controller.ts`

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

API resultante:

| Método | Ruta | Body | Respuesta |
|---|---|---|---|
| `POST` | `/todos` | `CreateTodoDto` | `201` Todo, `400` error de validación |
| `GET` | `/todos` | | `200` Todo[] (las más recientes primero) |
| `GET` | `/todos/:id` | | `200` Todo, `400` id inválido, `404` |
| `PATCH` | `/todos/:id` | `UpdateTodoDto` | `200` Todo, `400`, `404` |
| `DELETE` | `/todos/:id` | | `204`, `400`, `404` |

- `@Controller('todos')` es el prefijo de ruta; `@Get(':id')`, etc. agregan el resto.
- `@Body() dto: CreateTodoDto` es donde entra en acción el `ValidationPipe`: la clase del parámetro decide qué
  reglas se ejecutan, y el plugin de Swagger la usa como schema de la petición.
- Los tipos de retorno explícitos (`Promise<Todo>`, `Promise<Todo[]>`, `Promise<void>`) son lo que el plugin
  convierte en los schemas de respuesta, junto con el status que sale del verbo (`201` para `POST`, `200` en los
  demás casos) o de `@HttpCode`.
- `ParseObjectIdPipe` (de `@nestjs/mongoose`) rechaza con `400` los ids que no son ObjectIds de Mongo válidos,
  en lugar de dejar que Mongoose lance un error de cast (`500`).
- `@ApiTags('todos')` es el único decorador de Swagger que queda; solo agrupa las rutas en la UI. Las respuestas
  de error de la tabla de arriba son comportamiento real, pero no están en el documento; agrega
  `@ApiNotFoundResponse()` / `@ApiBadRequestResponse()` en una ruta si quieres que aparezcan.

## 7. Registra todas las piezas: `src/todos/todos.module.ts`

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

`MongooseModule.forFeature` crea el modelo (`"Todo"` + `TodoSchema` sobre la conexión compartida) y lo hace
inyectable dentro de este módulo, que es lo que resuelve `@InjectModel(Todo.name)`. Por último, el módulo se
lista en `AppModule.imports` (paso 2) para que Nest monte su controlador.

## 8. Swagger y el documento OpenAPI

### El plugin de CLI se encarga de las anotaciones

Sin ayuda, `@nestjs/swagger` solo ve lo que le dicen los decoradores: cada campo de DTO y de entidad necesitaría
un `@ApiProperty()` / `@ApiPropertyOptional()` y cada ruta un `@ApiOkResponse({ type })`. El plugin de CLI
elimina esa duplicación: se ejecuta dentro de `nest build` / `nest start`, lee los tipos de TypeScript y emite
los mismos metadatos en tiempo de compilación. Está habilitado en `nest-cli.json`:

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

| Opción | Efecto |
|---|---|
| `dtoFileNameSuffix` | Qué archivos contienen clases de modelo para anotar. Por defecto son `.dto.ts` y `.entity.ts`; se agrega `.schema.ts` para que la entidad de Mongoose también quede documentada. |
| `classValidatorShim` | Reutiliza los decoradores de `class-validator`: `@IsIn` → `enum`, `@MaxLength` → `maxLength`, `@Min`/`@Max`, `@Length`, `@Matches`... |
| `introspectComments` | Comentario JSDoc → `description`, etiqueta `@example` → `example`. |
| `esmCompatible` | Necesario porque este proyecto usa módulos ES. |

Lo que infiere por su cuenta: `string`/`number`/`boolean`/`Date` → tipo y formato de OpenAPI (`Date` se
convierte en `string` + `date-time`), `?` → opcional (el resto es `required`), una unión de literales de string
→ `enum`, arrays, clases anidadas y, en los controladores, el schema de respuesta a partir del tipo de retorno de
cada método y el status a partir del verbo o de `@HttpCode`.

Dos cosas que no puede ver: las opciones de Mongoose como `maxlength` en `@Prop(...)`, y las respuestas de error.
Si las necesitas en el documento, agrega el decorador explícito (`@ApiProperty({ maxLength: 120 })`,
`@ApiNotFoundResponse()`) solo en ese campo o ruta; los decoradores explícitos siempre tienen prioridad sobre el
plugin.

El plugin es parte del compilador de Nest, así que el código que ejecutan otras herramientas (por ejemplo
`vitest`) no recibe los metadatos. Eso solo importa si un test inspecciona el documento OpenAPI.

### Servir y exportar el documento

`src/swagger.ts` construye el documento una sola vez, compartido por el servidor y por el script generador:

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

`src/main.ts` lo sirve:

```ts
// Swagger UI at /api, raw OpenAPI JSON at /api-json
SwaggerModule.setup('api', app, createOpenApiDocument(app));
```

`src/openapi.ts` lo escribe en disco (`npm run openapi` = `nest build && node dist/openapi`):

```ts
const app = await NestFactory.create(AppModule, { logger: false });
writeFileSync('openapi.json', JSON.stringify(createOpenApiDocument(app), null, 2) + '\n');
await app.close();
```

`SwaggerModule.createDocument` recorre cada controlador y recopila las rutas, los schemas de petición (las clases
de `@Body()`), los schemas de respuesta (los tipos de retorno) y los metadatos por campo que emitió el plugin.
El resultado es la sección `components.schemas` con `Todo`, `CreateTodoDto` y `UpdateTodoDto`, que es lo que
consumen herramientas como los generadores de código.

## 9. Pruébala

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

## Agregar otra entidad

Repite los pasos 3 a 7 en una carpeta nueva dentro de `src/`. La CLI de Nest genera el esqueleto:

```bash
npx nest g resource projects     # choose "REST API"
```

luego reemplaza la entidad generada por una clase `@Schema`, agrega `MongooseModule.forFeature` al nuevo módulo
e inyecta el modelo en el servicio. Nombra los archivos `*.schema.ts` y `*.dto.ts`, y el plugin de Swagger los
detecta sin decoradores adicionales.
