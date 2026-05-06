// ============================================================================
// shared.js — Helpers used by every Function
// ============================================================================
//
// Two responsibilities:
//
//  1. Build a singleton Azure Blob ContainerClient. Credentials come from app
//     settings (NEVER from the browser). Either:
//        STORAGE_CONNECTION_STRING — full connection string, simplest
//        STORAGE_ACCOUNT_NAME      — paired with Managed Identity (recommended
//                                    for prod). The Function App's system
//                                    identity must have "Storage Blob Data
//                                    Contributor" on the storage account.
//
//  2. Parse the SWA-injected x-ms-client-principal header. Every authenticated
//     request to a SWA Functions API gets this header automatically. We trust
//     it because SWA validates the Entra ID token before forwarding the call;
//     no Function-side token validation is needed.
//
// ============================================================================

const { BlobServiceClient } = require("@azure/storage-blob");
const { DefaultAzureCredential } = require("@azure/identity");

const CONTAINER_NAME = process.env.STORAGE_CONTAINER_NAME || "cma-data";

// Blob names — keep them stable; the seed JSON files in your project use the
// same naming so existing data uploads cleanly.
const BLOB = {
  ASSESSMENTS: "cma-assessments.json",
  AUDIT: "cma-audit.json",
  OWNERS: "cma-owners.json",
  USERS: "cma-users.json",
};

let _container = null;

/**
 * Returns a cached ContainerClient. Creates the container if it doesn't exist.
 */
async function getContainer() {
  if (_container) return _container;

  const connStr = process.env.STORAGE_CONNECTION_STRING;
  const acctName = process.env.STORAGE_ACCOUNT_NAME;

  let serviceClient;
  if (connStr) {
    serviceClient = BlobServiceClient.fromConnectionString(connStr);
  } else if (acctName) {
    serviceClient = new BlobServiceClient(
      `https://${acctName}.blob.core.windows.net`,
      new DefaultAzureCredential()
    );
  } else {
    throw new Error(
      "Storage is not configured. Set either STORAGE_CONNECTION_STRING or STORAGE_ACCOUNT_NAME in the Static Web App application settings."
    );
  }

  const container = serviceClient.getContainerClient(CONTAINER_NAME);
  // createIfNotExists is idempotent and safe under concurrency.
  await container.createIfNotExists();
  _container = container;
  return container;
}

/**
 * Read a JSON blob. Returns the parsed object, or `fallback` if the blob
 * doesn't exist yet. Throws on auth/network errors.
 */
async function readJson(blobName, fallback = null) {
  const container = await getContainer();
  const blob = container.getBlobClient(blobName);
  try {
    const buf = await blob.downloadToBuffer();
    const text = buf.toString("utf8");
    if (!text || !text.trim()) return fallback;
    return JSON.parse(text);
  } catch (err) {
    if (err.statusCode === 404 || err.code === "BlobNotFound") return fallback;
    throw err;
  }
}

/**
 * Write a JSON blob, replacing whatever was there. Includes a soft optimistic
 * concurrency check via ETag when `expectedEtag` is given — used by /api/state
 * to surface conflicts when two users save at the same time.
 *
 * Returns { etag, lastModified }.
 */
async function writeJson(blobName, data, expectedEtag) {
  const container = await getContainer();
  const block = container.getBlockBlobClient(blobName);
  const body = JSON.stringify(data);
  const opts = {
    blobHTTPHeaders: { blobContentType: "application/json; charset=utf-8" },
  };
  if (expectedEtag) {
    opts.conditions = { ifMatch: expectedEtag };
  }
  const res = await block.upload(body, Buffer.byteLength(body, "utf8"), opts);
  return { etag: res.etag, lastModified: res.lastModified };
}

/**
 * Read JSON + return its ETag together. Used by /api/state so the client can
 * pass the ETag back on save and we can reject stale writes.
 */
async function readJsonWithEtag(blobName, fallback = null) {
  const container = await getContainer();
  const blob = container.getBlobClient(blobName);
  try {
    const dl = await blob.download();
    const chunks = [];
    for await (const chunk of dl.readableStreamBody) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString("utf8");
    const parsed = text && text.trim() ? JSON.parse(text) : fallback;
    return { data: parsed, etag: dl.etag };
  } catch (err) {
    if (err.statusCode === 404 || err.code === "BlobNotFound") {
      return { data: fallback, etag: null };
    }
    throw err;
  }
}

// ============================================================================
// Auth principal — decoded from x-ms-client-principal header
// ============================================================================

/**
 * Returns the SWA-authenticated principal, or null if the request is anonymous
 * (which shouldn't happen on protected routes, but defensive code is cheap).
 *
 * Shape:
 *   {
 *     userId: "...",
 *     userDetails: "user@onsemi.com",
 *     identityProvider: "aad",
 *     userRoles: ["authenticated", "admin"],
 *     claims: [...]   // Entra ID claims
 *   }
 */
function getPrincipal(request) {
  const header = request.headers.get
    ? request.headers.get("x-ms-client-principal")
    : request.headers["x-ms-client-principal"];
  if (!header) return null;
  try {
    const decoded = Buffer.from(header, "base64").toString("utf8");
    const p = JSON.parse(decoded);
    // Normalise — SWA uses "claims" with name/val pairs; collapse common ones
    // into a flat object for convenience.
    const claimsByType = {};
    for (const c of p.claims || []) {
      claimsByType[c.typ || c.type] = c.val || c.value;
    }
    return {
      userId: p.userId || claimsByType["http://schemas.microsoft.com/identity/claims/objectidentifier"] || "",
      email: (p.userDetails || claimsByType["preferred_username"] || claimsByType["email"] || "").toLowerCase(),
      name: claimsByType["name"] || p.userDetails || "",
      identityProvider: p.identityProvider || "aad",
      roles: p.userRoles || [],
      claims: claimsByType,
    };
  } catch (e) {
    return null;
  }
}

/** Reject the request unless the user has at least one of the required roles. */
function requireRole(principal, requiredRoles) {
  if (!principal) return { ok: false, status: 401, error: "Not signed in." };
  if (!requiredRoles || requiredRoles.length === 0) return { ok: true };
  const has = principal.roles.some((r) => requiredRoles.includes(r));
  if (!has) {
    return {
      ok: false,
      status: 403,
      error: `Forbidden. Required role: ${requiredRoles.join(" or ")}. You have: ${principal.roles.join(", ") || "none"}.`,
    };
  }
  return { ok: true };
}

/** Tiny JSON response helper. */
function json(status, body) {
  return {
    status,
    jsonBody: body,
    headers: { "Cache-Control": "no-store" },
  };
}

module.exports = {
  BLOB,
  getContainer,
  readJson,
  readJsonWithEtag,
  writeJson,
  getPrincipal,
  requireRole,
  json,
};
