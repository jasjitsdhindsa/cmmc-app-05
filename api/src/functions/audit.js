// ============================================================================
// /api/audit  —  shared audit log
// ============================================================================
//
// GET    ?limit=500&category=AUTH
//        → returns { entries: [...], total }
//        Admin-only, since audit logs reveal user activity.
//
// POST   body { category, action, details }
//        → appends ONE entry. The user identity is taken from the SWA
//        principal — the client cannot spoof who did the action. Every
//        authenticated user can append (so user actions get logged) but
//        only admins can read.
//
// Storage:
//   Single JSON blob `cma-audit.json` holding an array, newest-first. Capped
//   at AUDIT_MAX (default 5000) to keep the file size bounded. For higher
//   volume you'd switch to Azure Table Storage with a partition key per
//   month — left as a future improvement.
//
// ============================================================================

const { app } = require("@azure/functions");
const { BLOB, readJson, writeJson, getPrincipal, requireRole, json } = require("../shared");

const AUDIT_MAX = parseInt(process.env.AUDIT_MAX || "5000", 10);

const VALID_CATEGORIES = new Set([
  "AUTH", "USER", "ASSESSMENT", "SECURITY", "DATA", "ADMIN",
]);

function cap(v, n) { return String(v == null ? "" : v).slice(0, n); }

app.http("audit", {
  route: "audit",
  methods: ["GET", "POST"],
  authLevel: "anonymous",
  handler: async (request, context) => {
    const p = getPrincipal(request);
    if (!p) return json(401, { error: "Not signed in." });

    if (request.method === "GET") {
      const guard = requireRole(p, ["admin"]);
      if (!guard.ok) return json(guard.status, { error: guard.error });

      try {
        const entries = (await readJson(BLOB.AUDIT, [])) || [];
        const url = new URL(request.url);
        const limitRaw = parseInt(url.searchParams.get("limit") || "1000", 10);
        const limit = Math.min(Math.max(1, isNaN(limitRaw) ? 1000 : limitRaw), AUDIT_MAX);
        const category = url.searchParams.get("category") || "";

        let filtered = entries;
        if (category) filtered = filtered.filter((e) => e.category === category);
        return json(200, { entries: filtered.slice(0, limit), total: filtered.length });
      } catch (e) {
        context.log.error("[audit GET]", e);
        return json(500, { error: "Failed to read audit log: " + (e.message || String(e)) });
      }
    }

    // POST — append (any authenticated user)
    let body;
    try { body = await request.json(); }
    catch { return json(400, { error: "Body must be JSON." }); }

    const category = cap(body.category || "DATA", 32).toUpperCase();
    if (!VALID_CATEGORIES.has(category)) {
      return json(400, { error: `Invalid category. Must be one of: ${[...VALID_CATEGORIES].join(", ")}` });
    }

    // We retry once on ETag conflict — append is high-frequency and low-risk.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const entries = (await readJson(BLOB.AUDIT, [])) || [];
        const entry = {
          id: "al_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
          ts: new Date().toISOString(),
          category,
          action: cap(body.action, 120),
          details: cap(body.details, 1000),
          // Identity is FROM THE SERVER — never trust the client for this.
          userId: p.userId,
          userEmail: p.email,
          userRole: p.roles.find((r) => ["admin","assessor","auditor"].includes(r)) || "",
          userAgent: cap(request.headers.get("user-agent") || "", 200),
          ip: request.headers.get("x-forwarded-for") || "",
        };
        entries.unshift(entry);
        if (entries.length > AUDIT_MAX) entries.splice(AUDIT_MAX);
        await writeJson(BLOB.AUDIT, entries);
        return json(201, { ok: true, id: entry.id });
      } catch (e) {
        if (attempt < 2) continue;
        context.log.error("[audit POST]", e);
        return json(500, { error: "Failed to append audit entry: " + (e.message || String(e)) });
      }
    }
  },
});
