// ============================================================================
// /api/me  — Returns the current user as the front-end needs it
// ============================================================================
//
// The SWA endpoint /.auth/me already returns claims, but our front-end wants
// a normalized shape that matches the existing app's user object so we don't
// have to rewrite every component.
//
// Output shape:
//   {
//     id, email, fullName, role, dept, avatar, color,
//     roles: ["admin","assessor","auditor"],   // all roles, lowercase
//     primaryRole: "Admin"|"Assessor"|"Auditor"
//   }
//
// ============================================================================

const { app } = require("@azure/functions");
const { getPrincipal, json } = require("../shared");

const COLOR_MAP = { Admin: "#00d4ff", Assessor: "#7b2ff7", Auditor: "#f472b6" };

function pickPrimaryRole(roles) {
  if (roles.includes("admin")) return "Admin";
  if (roles.includes("assessor")) return "Assessor";
  if (roles.includes("auditor")) return "Auditor";
  return "Auditor";
}

function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "U";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

app.http("me", {
  route: "me",
  methods: ["GET"],
  authLevel: "anonymous",   // SWA does the auth; we read x-ms-client-principal
  handler: async (request, context) => {
    const p = getPrincipal(request);
    if (!p) return json(401, { error: "Not signed in." });

    const role = pickPrimaryRole(p.roles);
    const fullName =
      p.name ||
      [p.claims["given_name"], p.claims["family_name"]].filter(Boolean).join(" ") ||
      p.email.split("@")[0] ||
      "User";

    return json(200, {
      id: "aad_" + p.userId,
      email: p.email,
      fullName,
      role,
      primaryRole: role,
      roles: p.roles,
      dept: p.claims["department"] || p.claims["jobTitle"] || "",
      avatar: initials(fullName),
      color: COLOR_MAP[role] || "#537a98",
      identityProvider: p.identityProvider,
      mustChangePass: false,
    });
  },
});
