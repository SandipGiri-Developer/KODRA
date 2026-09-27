/**
 * Utility to check if a user is a KODRA team member
 */
export function isKODRATeamMember(email?: string): boolean {
  if (!email) return false;
  return email.includes("@kodra.dev");
}
