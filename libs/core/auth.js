import NextAuth from "next-auth";
import { MongoDBAdapter } from "@auth/mongodb-adapter";
import GoogleProvider from "next-auth/providers/google";
import { ObjectId } from "mongodb";
import config from "@/config";
import clientPromise from "./mongo";

// NextAuth v5 (beta) config. Google sign-in is the only provider for now.
// Exports { handlers, auth, signIn, signOut } — the route handler re-exports
// GET/POST from `handlers` (NOT the v4 default export).
//
// Two DB clients on purpose (see AGENTS.md): the raw MongoClient promise
// (libs/core/mongo.js) backs the adapter here; app queries use mongoose.
export const { handlers, auth, signIn, signOut } = NextAuth({
  // Set any random value in .env.local (NEXTAUTH_SECRET).
  secret: process.env.NEXTAUTH_SECRET,

  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_ID,
      clientSecret: process.env.GOOGLE_SECRET,
      // Link Google to an existing account sharing the same verified email.
      allowDangerousEmailAccountLinking: true,
      // Shape the user doc the adapter writes on first sign-in.
      async profile(profile) {
        return {
          id: profile.sub,
          name: profile.given_name || profile.name,
          email: profile.email,
          image: profile.picture,
          role: "user",
          createdAt: new Date(),
        };
      },
    }),
  ],

  // New users are persisted to MongoDB Atlas by the adapter. Requires MONGODB_URI.
  adapter: MongoDBAdapter(clientPromise),

  // JWT sessions: no DB round-trip to read the session on every request.
  session: {
    strategy: "jwt",
  },

  callbacks: {
    // Carry the role onto the token at sign-in so it survives in the JWT.
    async jwt({ token, user }) {
      if (user) {
        token.role = user.role || "user";
      }
      return token;
    },
    // Expose the user id and role on the session for downstream routes.
    async session({ session, token }) {
      if (session?.user) {
        session.user.id = token.sub;
        session.user.role = token.role || "user";
      }
      return session;
    },
  },

  events: {
    // Safety net: ensure every newly created user has a role, even if the
    // provider profile ever stops supplying one.
    async createUser({ user }) {
      if (user.role) return;
      try {
        const client = await clientPromise;
        await client
          .db()
          .collection("users")
          .updateOne(
            { _id: new ObjectId(user.id) },
            { $set: { role: "user" } }
          );
      } catch (error) {
        console.error("[auth] createUser: failed to set default role", error);
      }
    },
  },

  theme: {
    brandColor: config.colors.main,
    logo: `https://${config.domainName}/logoAndName.png`,
  },
});
