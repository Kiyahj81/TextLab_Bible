import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db";

function buildProviders(): NextAuthConfig["providers"] {
  const providers: NextAuthConfig["providers"] = [];

  if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
    providers.push(
      GitHub({
        clientId: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET
      })
    );
  }

  // Dev-only credentials provider. Lets the local server sign in without
  // a real OAuth integration. Disabled by default; turn on with
  // AUTH_DEV_ENABLED=1 and never set that in production.
  if (process.env.AUTH_DEV_ENABLED === "1") {
    providers.push(
      Credentials({
        id: "dev",
        name: "Dev login",
        credentials: {
          email: { label: "Email", type: "text", placeholder: "you@example.dev" },
          name: { label: "Display name", type: "text" }
        },
        async authorize(raw) {
          const email = typeof raw?.email === "string" ? raw.email.trim() : "";
          const name = typeof raw?.name === "string" ? raw.name.trim() : "";
          if (!email) return null;

          const user = await prisma.user.upsert({
            where: { email },
            create: { email, name: name || email },
            update: name ? { name } : {}
          });

          return { id: user.id, email: user.email ?? undefined, name: user.name ?? undefined };
        }
      })
    );
  }

  return providers;
}

export const authConfig: NextAuthConfig = {
  adapter: PrismaAdapter(prisma),
  // JWT strategy: required for the credentials provider; also avoids a DB
  // hit per request for OAuth flows. Sign-out works via cookie clear.
  // True session-revocation lives in Sprint 4 alongside its test.
  session: { strategy: "jwt" },
  providers: buildProviders(),
  callbacks: {
    async jwt({ token, user }) {
      // On initial sign-in the `user` is present; otherwise we keep the
      // existing token. The id is what every downstream handler needs.
      if (user && user.id) {
        token.userId = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.userId && session.user) {
        session.user.id = String(token.userId);
      }
      return session;
    }
  }
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
