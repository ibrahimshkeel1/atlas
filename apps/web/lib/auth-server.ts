import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";

const encoder = new TextEncoder();

function secretKey() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("JWT_SECRET is missing or too short");
  }
  return encoder.encode(secret);
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function createAccessToken(userId: string) {
  const minutes = Number(process.env.ACCESS_TOKEN_EXPIRE_MINUTES || 30);
  return new SignJWT({ type: "access" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${minutes}m`)
    .sign(secretKey());
}

export async function createRefreshToken(userId: string) {
  const days = Number(process.env.REFRESH_TOKEN_EXPIRE_DAYS || 14);
  return new SignJWT({ type: "refresh" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${days}d`)
    .sign(secretKey());
}

export async function getUserIdFromAccessToken(token: string): Promise<string> {
  const { payload } = await jwtVerify(token, secretKey());
  if (payload.type !== "access" || !payload.sub) {
    throw new Error("Invalid token");
  }
  return payload.sub;
}
