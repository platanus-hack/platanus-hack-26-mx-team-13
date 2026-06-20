import mongoose from "mongoose";

// Mongoose connection for all app queries (models live in /models).
// Separate from the raw MongoClient promise used by NextAuth (libs/core/mongo.js).
//
// Next.js dev hot-reload re-evaluates modules, which would open a new connection on
// every reload and trigger mongoose "multiple connections" warnings. We cache the
// connection (and the in-flight connect promise) on globalThis to reuse a single one.

let cached = globalThis._mongoose;
if (!cached) {
  cached = globalThis._mongoose = { conn: null, promise: null };
}

export async function connectMongoose() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      "Add the MONGODB_URI environment variable inside .env.local to use mongoose"
    );
  }

  // Already connected — reuse it.
  if (cached.conn) {
    return cached.conn;
  }

  // Connection in flight — await the same promise instead of opening another.
  if (!cached.promise) {
    cached.promise = mongoose.connect(uri, { bufferCommands: false });
  }

  try {
    cached.conn = await cached.promise;
  } catch (err) {
    // Reset the cached promise so a rejected connection isn't kept forever;
    // the next call retries a fresh connect once the DB/env/network recovers.
    cached.promise = null;
    throw err;
  }
  return cached.conn;
}

export default connectMongoose;
