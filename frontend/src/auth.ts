import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

// Add the field we put on the session so TypeScript knows about it.
declare module "next-auth" {
  interface Session {
    /** Google ID token (a JWT the backend verifies against Google's keys). Sent as a bearer token. */
    idToken?: string;
  }
}

// Auth.js reads AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET from the environment.
// Google's access tokens are opaque, so we send the ID token to our API instead.
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  callbacks: {
    // Runs whenever the session JWT is created or read. `account` exists only at sign-in time.
    jwt({ token, account }) {
      if (account?.id_token) token.idToken = account.id_token;
      return token;
    },
    // Shapes what useSession() / getSession() return on the client.
    session({ session, token }) {
      session.idToken = token.idToken as string | undefined;
      return session;
    },
  },
});
