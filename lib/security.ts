import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyGitHubSignature(body: string, signature: string | null, secret: string | undefined) {
  if (!secret || !signature?.startsWith("sha256=")) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  if (expected.length !== signature.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export function verifyBearerToken(header: string | null, expected: string | undefined) {
  if (!expected) return process.env.NODE_ENV !== "production";
  if (!header?.startsWith("Bearer ")) return false;
  const supplied = header.slice(7);
  if (supplied.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}
