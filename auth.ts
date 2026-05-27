import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db";
import { jwtCallback, sessionCallback, signOutEvent } from "@/lib/auth-callbacks";

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

const isProduction = process.env.NODE_ENV === "production";

export const authConfig: NextAuthConfig = {
  adapter: PrismaAdapter(prisma),
  // JWT strategy: required for the credentials provider; also avoids a DB
  // hit per request for OAuth flows. Sign-out revokes the JWT by bumping
  // user.sessionsValidFrom; the session callback then rejects any token
  // whose iat falls at or before that watermark, so a replayed cookie
  // captured before sign-out cannot survive it.
  session: { strategy: "jwt" },
  // Custom sign-in surface. Without this, Auth.js serves its own page at
  // /api/auth/signin which renders one button per configured provider — and
  // produces a blank page when no providers are configured. Routing here
  // also lets us style the page and add a sign-out control in the header.
  pages: {
    signIn: "/signin",
    error: "/signin"
  },
  // Cookie hardening. We set these explicitly so the policy is visible in
  // the repo, not implicit in framework defaults.
  //   - httpOnly: JS cannot read the session cookie (defense in depth
  //     against XSS-driven session theft).
  //   - sameSite "lax": MUST be lax (not strict) so the cookie survives
  //     the GitHub OAuth callback redirect. Cross-origin POST/PATCH/DELETE
  //     is separately blocked by lib/http/security.ts.
  //   - secure: production only; Auth.js applies the __Secure- cookie
  //     name prefix automatically when this is true.
  cookies: {
    sessionToken: {
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: isProduction
      }
    }
  },
  providers: buildProviders(),
  callbacks: {
    jwt: jwtCallback,
    session: sessionCallback
  },
  events: {
    signOut: signOutEvent
  }
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
