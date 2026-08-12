export type TeamRole = "STAFF" | "ADMIN" | "SUPER_ADMIN";
export type AccountRole = "CUSTOMER" | TeamRole;

export function canGrantTeamRole(actorRole: AccountRole, targetRole: Exclude<TeamRole, "SUPER_ADMIN">) {
  return targetRole === "STAFF" || actorRole === "SUPER_ADMIN";
}

export function canManageTeamAccount(actorRole: AccountRole, targetRole: AccountRole) {
  if (actorRole !== "ADMIN" && actorRole !== "SUPER_ADMIN") return false;
  if (targetRole === "CUSTOMER") return false;
  if (targetRole === "SUPER_ADMIN") return false;
  return targetRole === "STAFF" || actorRole === "SUPER_ADMIN";
}
