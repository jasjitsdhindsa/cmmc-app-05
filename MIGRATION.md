# Deployment & Migration Guide

This document is the complete cookbook for deploying the rearchitected
Cybersecurity Maturity Assessment (CMA) app. Read it once start-to-finish
before clicking anything in the Azure portal.

---

## 1. What changed and why

The previous build kept three things in the user's browser that should never
have lived there:

| Item                       | Before                       | After                            |
| -------------------------- | ---------------------------- | -------------------------------- |
| Entra ID Client / Tenant   | `localStorage`, per user     | App settings on the SWA resource |
| Storage SAS token          | `localStorage`, per user     | Storage connection string on SWA |
| Audit log                  | `localStorage`, per browser  | Single blob in Storage           |
| Assessments + owners       | Client-driven blob writes    | API-mediated writes with ETag    |
| Roles (Admin / Assessor)   | Free-text fields on the user | Entra group membership           |
| Passwords                  | Hand-rolled hash in JS       | Removed — SSO only               |

Net effect: configure once in the Azure portal, every user just signs in.

---

## 2. What you need before you start

- An Azure subscription where you can create resources.
- Permission to register an application in Microsoft Entra ID (the tenant
  admin can do this for you if you don't have it yourself).
- Node.js 20 installed locally if you want to test the API offline. Not
  required for deployment — Static Web Apps builds it for you.
- The two project JSON files: `cma-assessments.json` and `cma-audit.json`.
  These will be the seed data.

You will create three Azure resources:

1. **Storage account** for the JSON blobs.
2. **Entra ID application registration** for SSO.
3. **Static Web App** that hosts the frontend and the API.

Plus three **Entra ID security groups** for role assignment.

---

## 3. Create the Storage account

1. In the Azure portal, click **Create a resource → Storage account**.
2. Pick the same subscription and resource group you'll use for the SWA.
3. **Storage account name** — must be globally unique, lowercase, ≤24
   chars. Suggestion: `onsemicma<env><suffix>` e.g. `onsemicmaprod01`.
4. **Region** — pick the same region as your future SWA.
5. **Performance** = Standard, **Redundancy** = LRS (cheapest, fine for
   this workload).
6. **Networking** — leave "Enable public access from all networks" for now.
   You can lock this down later with private endpoints; the API
   authenticates with a connection string regardless.
7. Click through to create.

Once it's deployed, open the storage account and:

- Go to **Containers** → **+ Container** → name it `cma-data`, public
  access level = Private.
- Go to **Access keys** → copy the **Connection string** of `key1`. You'll
  paste this into the SWA app settings in step 6.

### Seed the existing data

Open the `cma-data` container and click **Upload**. Upload these two files
under their existing names (don't rename them):

- `cma-assessments.json` (from your project)
- `cma-audit.json` (from your project)

The other two blobs (`cma-owners.json`, `cma-users.json`) will be created
automatically the first time someone saves owners or the admin edits the
user directory.

---

## 4. Create three Entra ID security groups (for roles)

In Microsoft Entra ID → **Groups** → **New group**, create:

| Group name           | Purpose                                              |
| -------------------- | ---------------------------------------------------- |
| `CMA-Admins`         | Manage users, roles, audit log; full access          |
| `CMA-Assessors`      | Edit assessment scores and owners                    |
| `CMA-Auditors`       | Read-only access to dashboards and reports           |

For each group:
- Group type: **Security**
- Membership type: **Assigned** (or Dynamic if you have rules)
- Add at least one member to `CMA-Admins` — that's you, day one.

Copy each group's **Object ID** (a GUID, shown on the group's Overview
page). You'll need all three in step 6.

---

## 5. Register the app in Entra ID

1. In Entra ID → **App registrations** → **New registration**.
2. **Name** = `CMA - Cybersecurity Maturity Assessment`.
3. **Supported account types** = "Accounts in this organizational
   directory only" (single tenant). Pick multitenant only if you actually
   need it.
4. **Redirect URI** — leave blank for now. We'll fill it in after the
   SWA is created in step 7.
5. Click **Register**.

After registration:

### 5a. Copy these values for later

- **Application (client) ID** — a GUID on the Overview blade.
- **Directory (tenant) ID** — also a GUID on the Overview blade.

### 5b. Add a client secret

- **Certificates & secrets → Client secrets → New client secret**.
- Description: `swa-auth`. Expiry: 24 months (set a calendar reminder).
- **Copy the Value immediately** — Azure only shows it once.

### 5c. Configure groups & optional claims

This is the bit most people miss. We need the access token to include the
user's group memberships.

- **Token configuration → Add groups claim → Security groups → Add**.
- For ID, Access, and SAML: select **Group ID**.

Now Entra ID will include a `groups` claim in tokens; the SWA `/api/roles`
endpoint reads this claim to decide who is an admin.

> If your tenant has more than 200 group memberships per user, the
> `groups` claim is replaced by a `_claim_names` overage hint. For most
> orgs this isn't a problem; if it is for yours, switch from group claims
> to **app roles** instead (see Appendix A).

### 5d. API permissions

The defaults are fine. The app only needs `User.Read` (already there). Do
not add Microsoft Graph application permissions — the API doesn't call
Graph.

---

## 6. Create the Static Web App

1. In the Azure portal: **Create a resource → Static Web App**.
2. Same subscription / resource group as your storage account.
3. **Name** = `cma-app` (or whatever you like).
4. **Plan type** = **Standard**. (The Free tier supports custom Entra ID
   auth, but Standard gives you SLA, larger function payloads, and more
   roles. For a compliance app, pay for Standard.)
5. **Region** — same as your storage account.
6. **Deployment source** — choose GitHub or Azure DevOps and point it at
   the repo containing this code. The build defaults are:
   - App location: `/`
   - API location: `/api`
   - Output location: leave blank
7. Click through to create. Wait ~3 minutes for the first deployment to
   finish.

### 6a. Copy the SWA hostname

When the deployment finishes, the SWA Overview blade shows a hostname
like `proud-river-0abc1234.5.azurestaticapps.net`. Copy it.

### 6b. Set the redirect URI on the App registration

Go back to your Entra app registration → **Authentication** → **Add a
platform → Web** → **Redirect URI** =
`https://YOUR-SWA-HOSTNAME/.auth/login/aad/callback`

(That exact path with `/.auth/login/aad/callback` is what SWA uses.)

Tick **ID tokens** under "Implicit grant and hybrid flows".

If you'll also use a custom domain (e.g. `cma.onsemi.com`), add a second
redirect URI for that hostname too. The custom domain itself is added in
the SWA → Custom domains blade later.

### 6c. Configure SWA application settings

In the SWA → **Configuration** → **Application settings**, add:

| Name                          | Value                                                              |
| ----------------------------- | ------------------------------------------------------------------ |
| `AAD_CLIENT_ID`               | The Application (client) ID GUID from step 5a                      |
| `AAD_CLIENT_SECRET`           | The client secret value from step 5b                               |
| `AAD_TENANT_ID`               | The Directory (tenant) ID GUID from step 5a                        |
| `STORAGE_CONNECTION_STRING`   | The connection string from step 3                                  |
| `STORAGE_CONTAINER_NAME`      | `cma-data`                                                         |
| `ROLE_MAP_ADMIN`              | The Object ID of `CMA-Admins`                                      |
| `ROLE_MAP_ASSESSOR`           | The Object ID of `CMA-Assessors`                                   |
| `ROLE_MAP_AUDITOR`            | The Object ID of `CMA-Auditors`                                    |

Optional fallback for tiny teams that don't want to manage Entra groups:

| Name                          | Value                                                              |
| ----------------------------- | ------------------------------------------------------------------ |
| `ADMIN_EMAILS`                | Comma-separated list, e.g. `arun.s@onsemi.com,martin.m@onsemi.com` |
| `ASSESSOR_EMAILS`             | Same format                                                        |
| `AUDITOR_EMAILS`              | Same format                                                        |

If both group and email settings are present, both are honored — a user
gets the role if either matches.

### 6d. Substitute the openIdIssuer in staticwebapp.config.json

Open `staticwebapp.config.json` in your repo, find this line:

```json
"openIdIssuer": "https://login.microsoftonline.com/AAD_TENANT_ID/v2.0",
```

Replace `AAD_TENANT_ID` with the literal tenant GUID. (The other two
secrets — client ID and client secret — are read from app settings via
the `clientIdSettingName` and `clientSecretSettingName` fields, which is
correct. But the issuer URL must contain the literal GUID; SWA does not
substitute environment variables there.)

Commit and push. The SWA pipeline redeploys in about a minute.

---

## 7. First sign-in

Browse to your SWA hostname. You should see the login page with one
"Sign in with Microsoft" button. Click it. You'll land on the Microsoft
login page; sign in with an account that's a member of `CMA-Admins`.

You'll be redirected back to the app and should see the dashboard. In
**Settings → Diagnostics**, click **Test API & Auth** — it should return
"Authenticated as you@onsemi.com (role: Admin)".

If you see a 500 error or a blank page after sign-in:

- Check **Static Web App → Functions** in the portal. Each function
  should be in the list. If not, the build failed — check the
  GitHub Actions / DevOps pipeline log.
- Open browser DevTools → Network tab. Look at `/api/me` — the response
  body usually tells you exactly what's wrong (missing app setting,
  storage unreachable, etc.).

---

## 8. Common issues

**"AADSTS50011: The reply URL specified in the request does not match"**
The redirect URI on the app registration must be
`https://YOUR-SWA-HOSTNAME/.auth/login/aad/callback`, not just the
hostname.

**Login works but the user has role "Auditor" when they should be Admin**
The `groups` claim is missing or the group object ID doesn't match
`ROLE_MAP_ADMIN`. Test by adding the user's email to `ADMIN_EMAILS` as
a temporary fallback — if that fixes it, the group plumbing is at fault.
Verify in **Entra → App registration → Token configuration** that the
groups claim is configured for ID and Access tokens.

**"Storage is not configured" 500 error from `/api/state`**
`STORAGE_CONNECTION_STRING` is unset or wrong. After fixing app
settings, restart the Functions app: **Static Web App → Functions →
... → Restart** (or just push a trivial commit; SWA redeploys).

**Audit log appears empty for an admin**
Audit log only loads after the user navigates to the audit log page and
clicks **Show**. If clicking Show returns nothing, hit `/api/audit` directly
in DevTools to see the actual response body.

**Two users save the same assessment at the same time**
One of them gets a `409 Conflict` and a friendly banner: "Another user
saved before you. The latest data has been loaded — please re-apply
your changes." This is intentional and protects against silent data
loss.

---

## 9. Hardening for production (optional but recommended)

Once everything works, do these in order:

1. **Switch from connection string to Managed Identity.** Enable a
   system-assigned identity on the Static Web App, give it the **Storage
   Blob Data Contributor** role on the storage account, then in app
   settings remove `STORAGE_CONNECTION_STRING` and add
   `STORAGE_ACCOUNT_NAME` = your storage account name. The API code
   already supports both modes via `DefaultAzureCredential`.

2. **Lock down the storage account.** Networking → "Enabled from
   selected virtual networks and IP addresses" → add the SWA's outbound
   IPs (or use a Private Endpoint). The API will still work because the
   call is server-to-server; the browser never touches the storage
   account directly.

3. **Add a custom domain.** SWA → Custom domains → Add. Then add the
   custom domain to the Entra app registration's redirect URIs.

4. **Rotate the client secret.** Set a calendar reminder for 30 days
   before expiry. Regenerate, update `AAD_CLIENT_SECRET` in app
   settings, push a trivial commit.

5. **Enable Application Insights.** SWA → Application Insights → Enable.
   Function logs become searchable in the AI workspace and you get
   request rate / latency / error dashboards out of the box.

6. **Replace in-browser Babel with a real build.** Right now the
   frontend uses `@babel/standalone` to transpile JSX in the browser.
   That's slow and brittle. The proper fix is to add a Vite or
   esbuild build step that emits static JS at deploy time. The auth
   and API plumbing won't change — only the frontend tooling does.
   This isn't urgent; the app works without it.

---

## 10. What to demo to your stakeholders

Once it's running:

1. Sign in as an Admin user → set some scores → sign out.
2. Open an incognito window, sign in as an Assessor user → confirm
   they see the same scores. (This is the headline win: shared state.)
3. As Admin: open Settings → Diagnostics → Test API & Auth. Show the
   role detection working.
4. As Admin: open the Audit Log → set filters → click Show. Show the
   centralized audit covering both users' actions.
5. Try to open `/api/state` directly in incognito (signed out). You'll
   be redirected to the Microsoft login page — proving the API is not
   open to the world.

---

## Appendix A — Using App Roles instead of Groups

If your tenant has the >200-groups overage problem, define App Roles on
the app registration:

1. **Entra → App registration → App roles → Create app role**.
2. Create three roles: `Admin`, `Assessor`, `Auditor`. Allowed member
   types = Users/Groups.
3. **Enterprise applications → CMA → Users and groups → Add user/group**
   — assign users (or groups) to the role.
4. In Token configuration, add a **roles** claim instead of (or in
   addition to) the groups claim.
5. The `/api/roles` function reads both `groups` and `roles` claims, so
   no code change is needed. Just set `ROLE_MAP_ADMIN` /
   `ROLE_MAP_ASSESSOR` / `ROLE_MAP_AUDITOR` to the literal role values
   (`Admin`, `Assessor`, `Auditor`) instead of group object IDs.

---

## Appendix B — Local development

```bash
# Terminal 1 — API
cd api
npm install
# Set env for local dev:
export STORAGE_CONNECTION_STRING="DefaultEndpointsProtocol=https;AccountName=..."
export STORAGE_CONTAINER_NAME="cma-data"
export ADMIN_EMAILS="you@onsemi.com"
func start  # requires Azure Functions Core Tools v4

# Terminal 2 — SWA emulator (handles auth + serves the static site)
npm install -g @azure/static-web-apps-cli
swa start ./ --api-location ./api --run "echo serving"
# Browse http://localhost:4280/
# Sign in via the SWA emulator's mock auth (or wire up real Entra by
# editing swa-cli.config.json)
```

The mock auth lets you set arbitrary `userRoles` so you can test admin
vs auditor flows without touching Entra ID.
