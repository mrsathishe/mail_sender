import mongoose from "mongoose";
import { env } from "./env";

// Next.js hot-reloads modules in dev; cache the connection on the global object
// so we don't open a new pool on every file change.
type Cached = { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null };

const globalForMongoose = global as unknown as { _mongoose?: Cached };
const cached: Cached = globalForMongoose._mongoose ?? { conn: null, promise: null };
if (!globalForMongoose._mongoose) globalForMongoose._mongoose = cached;

export async function connectDB(): Promise<typeof mongoose> {
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    cached.promise = mongoose.connect(env.mongoUri, { bufferCommands: false });
  }
  cached.conn = await cached.promise;
  return cached.conn;
}
