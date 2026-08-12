import { requireSession, type Session } from "./auth";
import { hasStaffPermission, type StaffPermission } from "../../lib/staff-permissions";

const teamRoles = ["STAFF", "ADMIN", "SUPER_ADMIN"] as const;

export function sessionHasPermission(session: Session, permission: StaffPermission) {
  return hasStaffPermission(session.role, session.permissions, permission);
}

export async function requireTeamPermission(request: Request, permission: StaffPermission) {
  const auth = await requireSession(request, [...teamRoles]);
  if ("response" in auth) return auth;
  if (!sessionHasPermission(auth.session, permission)) return { response: Response.json({ error: "You do not have permission to perform this action." }, { status: 403 }) } as const;
  return auth;
}
