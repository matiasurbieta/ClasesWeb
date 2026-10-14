import createClient, { type Middleware } from "openapi-fetch";
import { getSession } from "next-auth/react";
import type { components, paths } from "./api-types";

/** A Todo exactly as the backend returns it (generated from openapi.json). */
export type ApiTodo = components["schemas"]["Todo"];

export const api = createClient<paths>({
  baseUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001",
});

// Adds the Auth0 access token to every call, so no call site changes.
// ponytail: getSession() hits /api/auth/session on each request; cache the token in memory if that shows.
const withAuth: Middleware = {
  async onRequest({ request }) {
    const session = await getSession();
    if (session?.accessToken) {
      request.headers.set("Authorization", `Bearer ${session.accessToken}`);
    }
    return request;
  },
};

api.use(withAuth);
