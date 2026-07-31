import { jwtVerify, SignJWT } from "jose";

export type Role = "CUSTOMER" | "STAFF" | "ADMIN" | "SUPER_ADMIN";
export type Session = { userId: number; email: string; firstName: string; role: Role; forcePasswordChange: boolean };

function secret() {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) throw new Error("AUTH_SECRET must contain at least 32 characters.");
  return new TextEncoder().encode(value);
}

export async function createSessionToken(session: Session) {
  return new SignJWT(session)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("8h")
    .setIssuer("healthfield-pharmacy")
    .setAudience("healthfield-web")
    .sign(secret());
}

export async function requestSession(request: Request, allowUploadToken = false): Promise<Session | null> {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  try {
    const { payload } = await jwtVerify(header.slice(7), secret(), {
      issuer: "healthfield-pharmacy",
      audience: allowUploadToken ? ["healthfield-web", "healthfield-upload"] : "healthfield-web",
    });
    return payload as unknown as Session;
  } catch {
    return null;
  }
}

export async function requireSession(request: Request, roles?: Role[], allowUploadToken = false) {
  const session = await requestSession(request, allowUploadToken);
  if (!session) return { response: Response.json({ error: "Authentication required." }, { status: 401 }) } as const;
  if (roles && !roles.includes(session.role)) return { response: Response.json({ error: "Access denied." }, { status: 403 }) } as const;
  return { session } as const;
}
