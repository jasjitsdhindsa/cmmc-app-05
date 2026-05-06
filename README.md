# Cybersecurity Maturity Assessment (CMA) — onsemi

A web app for tracking ISO 27001:2022 / CMMC L0–L5 maturity across 14 domains
and 112 controls, with role-based access for Admins, Assessors, and Auditors.

## Architecture (one paragraph)

Single Azure Static Web App. The frontend is a React app served from `/`.
The backend is a managed Azure Functions API at `/api/*` that talks to a
private Azure Storage account holding four JSON blobs (assessments,
owners, audit log, user directory). Authentication is Microsoft Entra
ID, configured *server-side* on the SWA resource — the browser never
sees a client ID, tenant ID, or storage credential. App-level roles
(Admin / Assessor / Auditor) are decided from Entra group membership at
login time by the `/api/roles` endpoint that SWA calls automatically.

```
   Browser
      │  fetch /api/state, /api/audit, /api/me
      ▼
┌───────────────────────────────────────────────┐
│  Azure Static Web App                         │
│  ├─ Static frontend (index.html)              │
│  ├─ Built-in Entra ID auth (/.auth/*)         │
│  └─ Functions API (/api/*)                    │
│       │ connection string / managed identity  │
│       ▼                                       │
│  Azure Storage Account                        │
│   container: cma-data                         │
│     cma-assessments.json                      │
│     cma-owners.json                           │
│     cma-audit.json                            │
│     cma-users.json                            │
└───────────────────────────────────────────────┘
```

## Repository layout

```
.
├── index.html                  Frontend — React, JSX, single file
├── staticwebapp.config.json    SWA routing + Entra ID auth config
├── api/
│   ├── host.json               Functions runtime config
│   ├── package.json            API dependencies
│   └── src/
│       ├── index.js            Function registration
│       ├── shared.js           Storage client, principal parser
│       └── functions/
│           ├── me.js           GET /api/me
│           ├── state.js        GET/PUT /api/state
│           ├── audit.js        GET/POST /api/audit
│           ├── users.js        GET/PUT /api/users
│           └── roles.js        POST /api/roles (called by SWA)
├── MIGRATION.md                Step-by-step deployment guide
├── cma-assessments.json        Seed data (upload to Storage)
└── cma-audit.json              Seed data (upload to Storage)
```

## Quick start

See `MIGRATION.md` for full deployment instructions. The 30-second
summary:

1. Create a Storage account with a `cma-data` container; upload the
   two seed JSON files.
2. Register an app in Entra ID; grab the client ID, tenant ID, and a
   client secret.
3. Create three Entra security groups: `CMA-Admins`, `CMA-Assessors`,
   `CMA-Auditors`. Add yourself to the first one.
4. Create a Static Web App pointed at this repo (App location `/`,
   API location `/api`).
5. Set application settings on the SWA: `AAD_CLIENT_ID`,
   `AAD_CLIENT_SECRET`, `AAD_TENANT_ID`, `STORAGE_CONNECTION_STRING`,
   `STORAGE_CONTAINER_NAME=cma-data`, plus `ROLE_MAP_ADMIN`,
   `ROLE_MAP_ASSESSOR`, `ROLE_MAP_AUDITOR` set to the three group
   object IDs.
6. In `staticwebapp.config.json`, replace the literal string
   `AAD_TENANT_ID` in `openIdIssuer` with your actual tenant GUID.
   Push the change.

You're done. Browse to your SWA hostname, click Sign in with Microsoft.

## What's intentionally NOT in this app

- **Local password authentication.** Removed. SSO is the only login
  method. If you need a break-glass account, create a separate Entra
  ID user with `CMA-Admins` membership.
- **Per-user storage configuration.** Removed. Storage is configured
  once on the SWA resource, not in the browser.
- **Per-user SSO configuration.** Removed. The Entra app registration
  is configured once on the SWA resource.
- **Direct browser-to-blob calls.** Removed. The browser only ever
  talks to `/api/*`; the API talks to storage.

## Operational notes

- **Concurrency**: `PUT /api/state` uses ETag-based optimistic
  concurrency. Two users saving the same assessment at the same time
  results in one of them getting a 409 and a friendly "another user
  saved before you" banner — no silent overwrites.
- **Audit log retention**: capped at 5,000 newest entries by default.
  Tunable via the `AUDIT_MAX` app setting. For higher volume, switch
  to Azure Table Storage (one row per entry, partition by month).
- **Role changes propagate at next sign-in.** If you add a user to
  `CMA-Admins`, they need to sign out and back in to see admin pages —
  the role is baked into their session cookie.

## License

Internal — onsemi.
