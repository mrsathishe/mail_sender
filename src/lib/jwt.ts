import { SignJWT, jwtVerify } from "jose";
import { env } from "./env";

// Edge-safe session token helpers (no next/headers, no Node APIs) so this
// module can be imported from middleware as well as route handlers.

export type SessionPayload = { userId: string; email: string };

const secretKey = () => new TextEncoder().encode(env.authSecret);
const MAX_AGE = "7d";

export async function signToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ email: payload.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.userId)
    .setIssuedAt()
    .setExpirationTime(MAX_AGE)
    .sign(secretKey());
}

export async function verifyToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (!payload.sub || typeof payload.email !== "string") return null;
    return { userId: payload.sub, email: payload.email };
  } catch {
    return null;
  }
}
