import { handlers } from "@/auth";

// Serves sign-in, the Auth0 callback, sign-out and the session endpoint under /api/auth/*.
export const { GET, POST } = handlers;
