import mongoose from "mongoose";
import { env } from "./env";

// Next.js hot-reloads modules in dev; cache the connection on the global object
// so we don't open a new pool on every file change.
type Cached = { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null };

const globalForMongoose = global as unknown as { _mongoose?: Cached };
const cached: Cached = globalForMongoose._mongoose ?? { conn: null, promise: null };
if (!globalForMongoose._mongoose) globalForMongoose._mongoose = cached;

export async function connectDB(): Promise<typeof mongoose> {
  // Nothing to connect to under MOCK_MODE: the models are the in-memory ones from
  // src/mocks/mock-db.ts, so every `await connectDB()` in the routes is a no-op rather
  // than a missing-MONGO_URI failure. Returning the unconnected instance is safe
  // precisely because no caller uses the return value.
  if (env.mockMode) return mongoose;
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    cached.promise = mongoose.connect(env.mongoUri, { bufferCommands: false });
  }
  cached.conn = await cached.promise;
  return cached.conn;
}
