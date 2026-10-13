import createClient from "openapi-fetch";
import type { components, paths } from "./api-types";

/** A Todo exactly as the backend returns it (generated from openapi.json). */
export type ApiTodo = components["schemas"]["Todo"];

export const api = createClient<paths>({
  baseUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001",
});
