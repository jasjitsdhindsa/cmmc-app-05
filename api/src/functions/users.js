// ============================================================================
// /api/users  —  read the cached user directory
// ============================================================================
//
// In the rearchitected app, users no longer live in localStorage. They are
// authenticated by Entra ID; their role assignments come from Entra group
// claims. This endpoint exposes a *cached, admin-curated* directory that
// the app uses for things like ownership assignment dropdowns and audit
// display names.
//
// We deliberately do NOT proxy Microsoft Graph here — that would require
// granting the Function App Graph permissions, which is a noisy security
// posture and not needed for the app's actual use.
//
// Each entry: { id, email, fullName, role, dept }
//
// GET    admin only
// PUT    admin only — bulk replace the directory (used by the admin UI)
//
// ============================================================================

const { app } = require("@azure/functions");
const { BLOB, readJson, writeJson, getPrincipal, requireRole, json } = require("../shared");

app.http("users", {
  route: "users",
  methods: ["GET", "PUT"],
  authLevel: "anonymous",
  handler: async (request, context) => {
    const p = getPrincipal(request);
    if (!p) return json(401, { error: "Not signed in." });

    const guard = requireRole(p, ["admin"]);
    if (!guard.ok) return json(guard.status, { error: guard.error });

    if (request.method === "GET") {
      try {
        const users = (await readJson(BLOB.USERS, [])) || [];
        return json(200, { users });
      } catch (e) {
        context.log.error("[users GET]", e);
        return json(500, { error: "Failed to read users: " + (e.message || String(e)) });
      }
    }

    // PUT — bulk replace
    let body;
    try { body = await request.json(); }
    catch { return json(400, { error: "Body must be JSON." }); }

    if (!Array.isArray(body.users)) {
      return json(400, { error: "Body must be { users: [...] }" });
    }

    // Strip anything we don't want stored — no passwordHash, no SAS, etc.
    const clean = body.users
      .filter((u) => u && typeof u.email === "string")
      .map((u) => ({
        id: String(u.id || "").slice(0, 80),
        email: String(u.email).toLowerCase().trim().slice(0, 120),
        fullName: String(u.fullName || u.email).slice(0, 120),
        role: ["Admin","Assessor","Auditor"].includes(u.role) ? u.role : "Auditor",
        dept: String(u.dept || "").slice(0, 80),
        avatar: String(u.avatar || "").slice(0, 8),
        color: String(u.color || "").slice(0, 16),
      }));

    try {
      await writeJson(BLOB.USERS, clean);
      return json(200, { ok: true, count: clean.length });
    } catch (e) {
      context.log.error("[users PUT]", e);
      return json(500, { error: "Failed to save users: " + (e.message || String(e)) });
    }
  },
});
