import NextAuth from "next-auth";
import Auth0 from "next-auth/providers/auth0";

// Add the field we put on the session so TypeScript knows about it.
declare module "next-auth" {
  interface Session {
    /** Access token for the Todos API (audience AUTH0_AUDIENCE). Sent as a bearer token. */
    accessToken?: string;
  }
}

// Auth.js reads AUTH_AUTH0_ID, AUTH_AUTH0_SECRET and AUTH_AUTH0_ISSUER from the environment.
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Auth0({
      // Without `audience` Auth0 issues an opaque access token that only Auth0 can check.
      // With it, the token is a JWT for our API, which the backend verifies offline.
      authorization: {
        params: { audience: process.env.AUTH0_AUDIENCE, scope: "openid profile email" },
      },
    }),
  ],
  callbacks: {
    // Runs whenever the session JWT is created or read. `account` exists only at sign-in time.
    jwt({ token, account }) {
      if (account?.access_token) token.accessToken = account.access_token;
      return token;
    },
    // Shapes what useSession() / getSession() return on the client.
    session({ session, token }) {
      session.accessToken = token.accessToken as string | undefined;
      return session;
    },
  },
});
