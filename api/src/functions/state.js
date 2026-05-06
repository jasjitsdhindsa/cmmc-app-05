// ============================================================================
// /api/state  —  shared assessments + owners
// ============================================================================
//
// GET    → returns { assessments, owners, etag }
// PUT    → body { assessments, owners, etag }
//          on ETag mismatch, returns 409 with the latest server copy so the
//          client can merge or warn. On match, writes both blobs and returns
//          the new etag.
//
// Roles
//   GET   any authenticated user
//   PUT   admin or assessor (auditors are read-only)
//
// Why a single combined endpoint?
//   The two blobs are read together every time and saved together every time
//   in the existing UI. Combining them halves the round-trips and lets us use
//   one ETag to coordinate edits.
//
// ============================================================================

const { app } = require("@azure/functions");
const { BLOB, readJsonWithEtag, writeJson, getPrincipal, requireRole, json } = require("../shared");

app.http("state", {
  route: "state",
  methods: ["GET", "PUT"],
  authLevel: "anonymous",
  handler: async (request, context) => {
    const p = getPrincipal(request);
    if (!p) return json(401, { error: "Not signed in." });

    if (request.method === "GET") {
      try {
        const [assess, owners] = await Promise.all([
          readJsonWithEtag(BLOB.ASSESSMENTS, []),
          readJsonWithEtag(BLOB.OWNERS, {}),
        ]);
        return json(200, {
          assessments: Array.isArray(assess.data) ? assess.data : [],
          owners: assess.data && typeof owners.data === "object" && !Array.isArray(owners.data) ? owners.data : {},
          etag: {
            assessments: assess.etag,
            owners: owners.etag,
          },
        });
      } catch (e) {
        context.log.error("[state GET]", e);
        return json(500, { error: "Failed to read state: " + (e.message || String(e)) });
      }
    }

    // PUT — write
    const guard = requireRole(p, ["admin", "assessor"]);
    if (!guard.ok) return json(guard.status, { error: guard.error });

    let body;
    try { body = await request.json(); }
    catch { return json(400, { error: "Body must be JSON." }); }

    const { assessments, owners, etag } = body || {};
    if (!Array.isArray(assessments)) {
      return json(400, { error: "Body must include an `assessments` array." });
    }
    if (owners != null && (typeof owners !== "object" || Array.isArray(owners))) {
      return json(400, { error: "`owners` must be an object." });
    }

    try {
      const writes = [];
      writes.push(writeJson(BLOB.ASSESSMENTS, assessments, etag?.assessments));
      if (owners) writes.push(writeJson(BLOB.OWNERS, owners, etag?.owners));
      const results = await Promise.all(writes);

      return json(200, {
        ok: true,
        etag: {
          assessments: results[0].etag,
          owners: owners ? results[1].etag : null,
        },
        savedBy: p.email,
        savedAt: new Date().toISOString(),
      });
    } catch (e) {
      // ConditionNotMet = ETag mismatch = someone saved between our read and write
      if (e.statusCode === 412 || e.code === "ConditionNotMet") {
        const fresh = await Promise.all([
          readJsonWithEtag(BLOB.ASSESSMENTS, []),
          readJsonWithEtag(BLOB.OWNERS, {}),
        ]);
        return json(409, {
          error: "Conflict: another user saved while you were editing. Reload to pick up their changes, then re-apply yours.",
          latest: {
            assessments: fresh[0].data,
            owners: fresh[1].data,
            etag: { assessments: fresh[0].etag, owners: fresh[1].etag },
          },
        });
      }
      context.log.error("[state PUT]", e);
      return json(500, { error: "Failed to save state: " + (e.message || String(e)) });
    }
  },
});
