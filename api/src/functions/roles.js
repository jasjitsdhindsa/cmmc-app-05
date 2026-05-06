// ============================================================================
// /api/roles  (called by Static Web Apps on every login)
// ============================================================================
//
// SWA calls this internally after Entra ID authenticates a user. We respond
// with the list of app-level roles ("admin", "assessor", "auditor") that
// SWA should attach to the principal for this request and all subsequent
// requests in the session.
//
// How roles are decided
// ─────────────────────
//   1.  Group claim mapping (preferred). Set ROLE_MAP_ADMIN / ROLE_MAP_ASSESSOR
//       / ROLE_MAP_AUDITOR app settings to comma-separated lists of Entra
//       Group Object IDs (or App Role values). Any user whose token contains
//       a matching group/role gets the corresponding app role.
//
//   2.  Email allowlist (fallback). Set ADMIN_EMAILS, ASSESSOR_EMAILS,
//       AUDITOR_EMAILS as comma-separated email lists for small teams that
//       don't want to manage Entra groups.
//
//   3.  Default: every authenticated user gets "auditor" (read-only).
//
// SWA combines whatever we return with the built-in "authenticated" role
// automatically — we don't need to include it.
//
// ============================================================================

const { app } = require("@azure/functions");

function listSetting(name) {
  const raw = process.env[name] || "";
  return raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

app.http("roles", {
  route: "roles",
  methods: ["POST"],          // SWA always POSTs
  authLevel: "anonymous",     // SWA calls this with no principal yet
  handler: async (request, context) => {
    let body = {};
    try { body = await request.json(); } catch (_) {}

    const email = String(body.userDetails || "").toLowerCase();
    const claims = body.claims || [];
    const groups = claims
      .filter((c) => (c.typ || c.type) === "groups")
      .map((c) => c.val || c.value);
    const appRoles = claims
      .filter((c) => (c.typ || c.type) === "roles")
      .map((c) => c.val || c.value);
    const tokens = new Set([...groups, ...appRoles]);

    const adminGroups    = listSetting("ROLE_MAP_ADMIN");
    const assessorGroups = listSetting("ROLE_MAP_ASSESSOR");
    const auditorGroups  = listSetting("ROLE_MAP_AUDITOR");

    const adminEmails    = listSetting("ADMIN_EMAILS");
    const assessorEmails = listSetting("ASSESSOR_EMAILS");
    const auditorEmails  = listSetting("AUDITOR_EMAILS");

    const matchAny = (a, b) => a.some((x) => b.has(x));
    const roles = new Set();

    if (matchAny(adminGroups, tokens) || adminEmails.includes(email)) roles.add("admin");
    if (matchAny(assessorGroups, tokens) || assessorEmails.includes(email)) roles.add("assessor");
    if (matchAny(auditorGroups, tokens) || auditorEmails.includes(email)) roles.add("auditor");

    // Default: every authenticated user can at least read (auditor)
    if (roles.size === 0) roles.add("auditor");

    context.log(`[roles] ${email} -> ${[...roles].join(",")}`);
    return { jsonBody: { roles: [...roles] } };
  },
});
