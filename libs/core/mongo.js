import { MongoClient } from "mongodb";

// Raw MongoClient promise used ONLY by the NextAuth adapter (@auth/mongodb-adapter).
// App queries go through mongoose (see libs/core/mongoose.js). Two clients on purpose.
// The connect promise is cached on globalThis so Next.js dev hot-reload reuses one client.

const uri = process.env.MONGODB_URI;
const options = {};

let clientPromise;

if (!uri) {
  // Not thrown at import time: builds and routes that don't touch auth must still work.
  console.warn(
    "[mongo] MONGODB_URI is missing — the NextAuth adapter will fail until it is set."
  );
} else if (process.env.NODE_ENV === "development") {
  // Reuse the same connect promise across hot-reloads in dev.
  if (!globalThis._mongoClientPromise) {
    const client = new MongoClient(uri, options);
    globalThis._mongoClientPromise = client.connect();
  }
  clientPromise = globalThis._mongoClientPromise;
} else {
  // In production a single module instance is enough.
  const client = new MongoClient(uri, options);
  clientPromise = client.connect();
}

export default clientPromise;
