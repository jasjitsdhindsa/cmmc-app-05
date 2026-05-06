# Fresh Setup — Complete Step-by-Step Guide

This is the **definitive** setup guide for the CMA app. It assumes you're
starting completely from scratch: new GitHub repo, new Azure resources, new
Entra ID app registration. It incorporates every lesson learned in earlier
attempts.

**Estimated time:** 2 hours of focused work.

**Cost:** ~$10/month once running (mostly the Static Web App Standard tier).

---

## What you're going to build

```
   Browser
      │  (always HTTPS, browser holds NO secrets)
      ▼
   Azure Static Web App  (one resource, one URL)
      ├─ Frontend: index.html (React)
      ├─ Built-in Entra ID auth at /.auth/login/aad
      └─ Functions API at /api/*
            │
            ▼
   Azure Storage Account  (private, only the API can reach it)
      └─ Container: cma-data
          ├─ cma-assessments.json
          ├─ cma-audit.json
          ├─ cma-owners.json
          └─ cma-users.json
```

---

## Critical lessons from the previous attempt

Internalize these before starting. They will save you an hour.

1. **Files must be at the repo ROOT** — not inside a subfolder. The Static
   Web App build expects to find `index.html`, `staticwebapp.config.json`,
   and the `api/` folder at the top level.

2. **Use the `main` branch directly** — don't create a feature branch.
   Static Web Apps deploys from `main` (by default), and a feature branch
   that's never merged just confuses things.

3. **Redirect URI platform type MUST be "Web"** — not "Single-page
   application", not "Mobile and desktop". The new Azure portal
   "Authentication (Preview)" page sometimes defaults to wrong types.
   Use the classic "Add a platform" → **Web** flow.

4. **Free-tier Entra tenants can't assign groups to apps** — so you'll
   use the email allowlist (`ADMIN_EMAILS` app setting) instead of
   security groups. The code supports both; emails are simpler for
   free tier.

5. **Replace `AAD_TENANT_ID` literally** in `staticwebapp.config.json`
   before pushing. SWA does not substitute environment variables in
   the `openIdIssuer` URL.

6. **Always test in incognito.** Browser cache is the #1 cause of
   "I deployed but nothing changed" panics.

---

## Part 0 — Before you start

You need:

- An Azure subscription where you can create resources. ✅ (You have this.)
- Permission to register apps and create groups in Entra ID. ✅ (You have this.)
- A GitHub account with permission to create new repos. ✅ (You have this.)
- The zip file of code (`cma-rearchitected.zip` from earlier).

Open a Notepad window. You'll be pasting GUIDs and connection strings
into it constantly. Label each one as you copy it.

```
=== CMA Setup — values to track ===
Subscription:                    sb-npe-coe-001
Region:                          ___________________________
Resource group:                  ___________________________
Storage account name:            ___________________________
Storage connection string:       ___________________________
SWA name:                        ___________________________
SWA URL:                         ___________________________
Entra App: client ID:            ___________________________
Entra App: tenant ID:            ___________________________
Entra App: client secret VALUE:  ___________________________
Admin user email:                ___________________________
GitHub repo URL:                 ___________________________
```

---

## Part 1 — Create the GitHub repo (10 min)

### 1.1 Create an empty repo

1. Go to https://github.com/new (sign in if needed).
2. **Owner:** your account (or org).
3. **Repository name:** `cma-app` (or anything you like — *short* is good).
4. **Description:** "Cybersecurity Maturity Assessment".
5. **Public** or **Private:** Private is fine (recommended for prod).
6. ✅ Tick **Add a README file**. (Just so the repo isn't completely empty.)
7. Click **Create repository**.
8. Copy the repo URL into Notepad. Format:
   `https://github.com/YOUR-USERNAME/cma-app`

### 1.2 Upload all code files

You'll be uploading the contents of the zip — but **the contents, not the
zip folder itself**.

1. On your computer, extract `cma-rearchitected.zip` somewhere convenient.
   You'll see a folder called `cma-rearchitected` containing files like
   `index.html`, `staticwebapp.config.json`, an `api` subfolder, etc.
2. **Open** the `cma-rearchitected` folder so you're seeing its contents
   directly (not the folder itself).
3. Back on GitHub, in your new empty repo, click **Add file → Upload files**.
4. **Select the contents** of the `cma-rearchitected` folder (Ctrl+A) and
   drag them into the upload area in the browser. **Do NOT drag the
   folder itself.** GitHub should preserve the `api/` subfolder structure
   automatically.
5. Wait for "All files uploaded successfully."
6. Scroll to the bottom. Commit message: `Initial app upload`.
7. Make sure **Commit directly to the `main` branch** is selected
   (not "Create a new branch").
8. Click **Commit changes**.

### 1.3 Verify the file layout

After upload, your repo's main page should show this layout (top level):

```
api/                       ← folder with subfolders inside
  host.json
  package.json
  src/
    index.js
    shared.js
    functions/
      audit.js
      me.js
      roles.js
      state.js
      users.js
AZURE-WALKTHROUGH.md
MIGRATION.md
README.md
SETUP-GUIDE.md             ← this file
cma-assessments.json       (optional — seed data)
cma-audit.json             (optional — seed data)
index.html                 ← MUST be at top level
staticwebapp.config.json   ← MUST be at top level
```

**Critical check:** click on `index.html` and verify line 18-22 contain
the comment about "Authentication is now handled server-side by Azure
Static Web Apps' built-in Entra ID integration." If they do, the right
file is in the right place.

If you see a folder called `cma-rearchitected/` in your repo with all
the files inside it, **stop and fix this** — the SWA build won't work.
Easiest fix: delete the entire repo (Settings → Danger Zone → Delete
this repository), recreate it, and re-upload more carefully.

---

## Part 2 — Create the Azure resource group + storage (15 min)

### 2.1 Sign in to Azure

1. Go to https://portal.azure.com.
2. Sign in with your work account.
3. Note which subscription is active (top-right or breadcrumb). Should
   be `sb-npe-coe-001` based on your screenshots.

### 2.2 Pick a region and write it down

Use the same region for all resources. Recommended: **East US 2** or
**Central US** for US-based teams. Whatever you pick, write it in
Notepad — you'll select it ~5 more times.

### 2.3 Create a resource group

1. Search bar at top → `Resource groups` → click result.
2. Click **+ Create**.
3. **Subscription:** `sb-npe-coe-001` (or whichever you use).
4. **Resource group name:** `rg-cma-prod` (or `rg-it-gis-cma-02` if you
   want to follow naming conventions you've used before).
5. **Region:** the one you picked.
6. Click **Review + create**, then **Create**.
7. Wait ~30 seconds. Refresh the resource groups list to confirm it's there.

### 2.4 Create a storage account

1. Search bar → `Storage accounts` → click result.
2. Click **+ Create**.
3. **Basics tab:**
   - Subscription: same as above.
   - Resource group: the one you just created.
   - **Storage account name:** must be globally unique, lowercase, 3–24
     chars, no hyphens. Try `cmaprod` + 4 random digits, e.g. `cmaprod7842`.
     If taken, try another suffix.
   - Region: same as above.
   - **Performance:** Standard.
   - **Redundancy:** **LRS** (Locally-redundant storage) — cheapest.
4. **Networking tab:** "Enable public access from all networks" (you can
   restrict later).
5. **Data protection tab:** Tick **Enable soft delete for blobs** with
   retention 30 days. This protects against accidentally deleting
   `cma-assessments.json`. Costs nothing extra for this volume.
6. Other tabs: defaults are fine.
7. **Review + create**, then **Create**. Wait 1–2 minutes.
8. Click **Go to resource**.

### 2.5 Create the container

1. On the storage account, left menu → **Data storage → Containers**.
2. Click **+ Container**.
3. **Name:** `cma-data` (exactly this — lowercase, with hyphen).
4. **Anonymous access level:** Private (no anonymous access).
5. Click **Create**.

### 2.6 Upload the seed JSON files (optional but recommended)

If you want to start with the existing assessment data:

1. Click on the `cma-data` container.
2. Click **Upload**.
3. Browse to your extracted `cma-rearchitected` folder.
4. Select `cma-assessments.json` and `cma-audit.json`.
5. Click **Upload**.

Without this step, the app starts empty and you'd have to recreate the
assessment from scratch. With it, you'll see your existing data on
first sign-in.

### 2.7 Copy the connection string

1. Storage account left menu → **Security + networking → Access keys**.
2. Click **Show** next to "Connection string" under key1.
3. Click the copy icon.
4. **Paste into Notepad immediately**, labeled `Storage connection string`.

It looks like:
```
DefaultEndpointsProtocol=https;AccountName=cmaprod7842;AccountKey=very-long-base64-string==;EndpointSuffix=core.windows.net
```

**Treat this like a password.** It's the keys to the kingdom. Don't
paste it in chat, don't email it, don't commit it to GitHub.

---

## Part 3 — Register the Entra ID app (15 min)

### 3.1 Create the registration

1. Search bar → **App registrations** → click result.
2. Click **+ New registration**.
3. **Name:** `CMA-App-Prod` (or similar — *be deliberate*; this name
   appears to users on the consent screen).
4. **Supported account types:** **Single tenant** (only your org).
5. **Redirect URI:** **LEAVE BLANK FOR NOW.** We'll add it after the
   SWA exists in Part 4. Resist the urge.
6. Click **Register**.

### 3.2 Copy two GUIDs

You're now on the app's Overview page.

1. Find **Application (client) ID** — copy to Notepad as
   `Entra App: client ID`.
2. Find **Directory (tenant) ID** — copy to Notepad as
   `Entra App: tenant ID`.

### 3.3 Create a client secret

1. Left menu → **Certificates & secrets**.
2. Click **+ New client secret**.
3. **Description:** `swa-auth`.
4. **Expires:** **730 days** (24 months). Set yourself a calendar
   reminder for **~22 months from today** to rotate this. When the
   secret expires, every user is locked out simultaneously and the
   only fix is replacing the secret.
5. Click **Add**.
6. **CRITICAL:** the secret's **Value** is shown ONCE, right now, on
   this screen. Copy the **Value** column (NOT the "Secret ID"
   column) — it's a long string starting with characters like `Abc~_8...`.
7. Paste into Notepad as `Entra App: client secret VALUE`.

If you navigate away before copying, the value disappears forever and
you have to delete + recreate the secret.

### 3.4 Configure token claims

This makes the token include the user's email and (if you ever upgrade
to P1) their groups.

1. Left menu → **Token configuration**.
2. **+ Add optional claim** → ID → tick `email`, `preferred_username`,
   `family_name`, `given_name` → click **Add**.
3. If prompted to add Microsoft Graph permissions, click **Yes**.
4. Repeat for **Access** token if you want — same fields. Optional.

### 3.5 (Skip group claim for now — your tenant doesn't support it)

In the previous attempt we hit "Groups are not available for assignment
due to your Active Directory plan level." So we won't bother with the
group claim — we'll use the email allowlist instead in Part 5.

---

## Part 4 — Create the Static Web App (15 min)

### 4.1 Create the resource

1. Search bar → **Static Web Apps** → click result.
2. Click **+ Create**.
3. **Basics tab:**
   - Subscription: same as before.
   - Resource group: the one from Part 2.
   - **Name:** `swa-cma-prod` or similar.
   - **Plan type:** **Standard.** (Free works but lacks SLA.)
   - **Region** for Azure Functions API: closest to your storage
     account region.
4. **Deployment details:**
   - **Source:** GitHub.
   - Click **Sign in with GitHub** → authorize Azure to access your
     repos.
   - **Organization:** your GitHub username/org.
   - **Repository:** the one you created in Part 1.
   - **Branch:** `main`.
5. **Build details:**
   - **Build presets:** Custom.
   - **App location:** `/`
   - **API location:** `/api`
   - **Output location:** *leave blank*.
6. Click **Review + create**, then **Create**. Wait 2–3 minutes.

### 4.2 Wait for the first deployment

After the resource is created:

1. Click **Go to resource**.
2. On the Overview blade, find the **URL** field — looks like
   `https://kind-flower-0abc1234.5.azurestaticapps.net`. **Copy it
   into Notepad.**
3. Watch the deployment: scroll down to **Deployment history**, or
   open your GitHub repo's **Actions** tab in another browser tab.
4. The first build takes 3–5 min. **Wait for the green checkmark.**

If it fails:
- Click into the failed run on GitHub Actions.
- Find the failed step (red X), expand its logs.
- Common errors:
  - `package.json not found`: the api folder didn't upload right.
  - `Cannot find module`: similar — incomplete upload.
  - Send me a screenshot of the error if it's something else.

### 4.3 Add the redirect URI to the app registration

Now that you have the SWA URL, complete the Entra setup.

1. Search bar → **App registrations** → click your `CMA-App-Prod` app.
2. Left menu → **Authentication**.
3. **Important:** if you see "Welcome to the new and improved
   experience" or "(Preview)" in the title, click **"To switch to the
   old experience, please click here"** at the top. The old experience
   has a clearer "Add a platform" flow.
4. Click **+ Add a platform**.
5. Pick **Web** (NOT Single-page application, NOT Mobile and desktop).
6. **Redirect URIs:** paste — **EXACTLY**, no trailing slash, no typos:
   ```
   https://kind-flower-0abc1234.5.azurestaticapps.net/.auth/login/aad/callback
   ```
   (replace the hostname with YOUR SWA URL, keep `/.auth/login/aad/callback`).
7. **Front-channel logout URL:** leave blank.
8. **Implicit grant and hybrid flows:** ✅ tick **ID tokens**. Leave
   Access tokens unticked.
9. Click **Configure**.

Verify: the Authentication page should now show:
- Platform: **Web** (not Single-page application).
- One Redirect URI ending in `/.auth/login/aad/callback`.
- ID tokens: ticked.

**This is the #1 thing that broke your previous attempt. Triple-check
the platform is "Web".**

---

## Part 5 — Configure SWA application settings (10 min)

### 5.1 Edit `staticwebapp.config.json` in GitHub

The config file has a placeholder `AAD_TENANT_ID` that must be replaced
with your actual tenant ID GUID.

1. Go to your repo on GitHub.
2. Click `staticwebapp.config.json`.
3. Click the pencil icon (top-right) to edit.
4. Find this line near the top:
   ```json
   "openIdIssuer": "https://login.microsoftonline.com/AAD_TENANT_ID/v2.0",
   ```
5. Replace **only** the literal string `AAD_TENANT_ID` with your
   tenant ID GUID from Notepad. Result:
   ```json
   "openIdIssuer": "https://login.microsoftonline.com/12345678-abcd-...etc/v2.0",
   ```
6. Scroll down. Commit message: `Set tenant ID in openIdIssuer`.
7. Confirm "Commit directly to the `main` branch" is selected.
8. Click **Commit changes**.

This triggers another build — wait 3 minutes for it to complete.

### 5.2 Set application settings

1. In Azure portal, go to your SWA → left menu → **Settings →
   Environment variables** (older portals: **Configuration**).
2. Click the **Application settings** tab.
3. Click **+ Add** for each row below, paste the name and value, click
   **OK** between each:

| Name | Value |
|------|-------|
| `AAD_CLIENT_ID` | client ID GUID from Notepad |
| `AAD_CLIENT_SECRET` | secret VALUE from Notepad |
| `AAD_TENANT_ID` | tenant ID GUID from Notepad |
| `STORAGE_CONNECTION_STRING` | connection string from Notepad |
| `STORAGE_CONTAINER_NAME` | `cma-data` |
| `ADMIN_EMAILS` | your admin email(s), comma-separated |

For `ADMIN_EMAILS`, use the email you'll sign in with. From your
screenshots that looks like `a.zbqg9m@OnsemiNPE.onmicrosoft.com`.
You can add more, comma-separated:
```
a.zbqg9m@OnsemiNPE.onmicrosoft.com,jasjit.dhindsa@onsemi.com
```

4. **CRITICAL:** click **Save** at the top after adding all settings.
   The portal does NOT save automatically. Wait for "Application
   settings saved successfully."

> Optional later additions (skip for now):
> - `ASSESSOR_EMAILS` — comma-separated assessor emails
> - `AUDITOR_EMAILS` — comma-separated auditor emails
> - `ROLE_MAP_ADMIN`, `ROLE_MAP_ASSESSOR`, `ROLE_MAP_AUDITOR` — Entra
>   group object IDs (only useful with P1 license)

---

## Part 6 — Test (10 min)

### 6.1 Verify the deploy is current

1. Go to your repo's **Actions** tab.
2. The most recent workflow run should be from your `Set tenant ID`
   commit and should show a green checkmark.
3. If anything is yellow or red, wait/fix before testing.

### 6.2 First sign-in

1. Open a brand new **incognito** (Chrome/Edge) or **private** (Firefox)
   window. **Do not use a regular window** — cache will lie to you.
2. Browse to your SWA URL.
3. **Expected:** a login screen with one big blue "Sign in with
   Microsoft" button. No email/password form. No orange warning.
4. Click **Sign in with Microsoft**.
5. Microsoft login appears. Sign in with your admin email
   (`a.zbqg9m@OnsemiNPE.onmicrosoft.com`).
6. First time only: a consent screen appears asking to grant
   permissions to "CMA-App-Prod". Click **Accept**.
7. You should be redirected back and land on the dashboard.

### 6.3 Verify role detection

1. In the app, navigate to **Settings**.
2. Find **Diagnostics → Test API & Auth** (visible only to admins).
3. Click the button. Expected response:
   > ✓ Authenticated as a.zbqg9m@onsemiNPE.onmicrosoft.com (role: Admin).
   > The API is reachable and your Entra ID session is valid.

If role shows as Auditor instead of Admin: the email match in
`ADMIN_EMAILS` failed. Double-check the email is exactly the same
(case-insensitive, but no typos). Easiest test: add it again as a
new app setting and click Save.

### 6.4 The headline test — shared state across browsers

This is the original goal. Verify it works.

1. Stay signed in on Browser A.
2. Open Browser B (different from A — e.g., Firefox if A was Chrome).
3. Go to the same SWA URL.
4. You should see the same login screen — **no "SSO not configured"
   warning, no setup needed.**
5. Sign in with the same Microsoft account.
6. **Expected:** you land on the same dashboard, with the same data.

That's the win. Both browsers see the same SSO config, the same data,
the same audit log. No per-browser configuration anywhere.

### 6.5 Verify data is shared

1. On Browser A: go to a domain, set or change a score, save.
2. On Browser B: refresh (or wait ~30 seconds for auto-poll).
3. The change should appear on Browser B.

If it doesn't:
- DevTools (F12) on Browser B → Network tab → look at the request to
  `/api/state`. Click it. The Response tab shows what the server returned.
- 401 = session issue, sign out and back in.
- 500 = server error, click into the response body for the actual message.

---

## Part 7 — Troubleshooting reference

### "AADSTS50011: redirect URI mismatch"

Your redirect URI in the Entra app registration doesn't match
what SWA is sending. SWA always sends:
```
https://YOUR-SWA/.auth/login/aad/callback
```

Open the app registration → Authentication. Make sure:
- The platform is **Web** (not SPA).
- The URI ends in `/.auth/login/aad/callback`.
- No typos.

If you have an extra URI listed (like the bare hostname with `/` only),
delete it.

### Login works but role is Auditor (should be Admin)

`ADMIN_EMAILS` doesn't match. Open SWA → Configuration → confirm:
- The email is the EXACT email shown in the user's principal
  (`/.auth/me` → look at `userDetails`).
- For the OnsemiNPE tenant, this would be
  `a.zbqg9m@onsemiNPE.onmicrosoft.com`, not
  `a.zbqg9m@onsemi.com` or similar.

After fixing, sign out (`/.auth/logout`), sign back in. Roles are
baked into the session cookie at sign-in time.

### Old login screen still shows

99% likely cause: cache. Hard-reload (Ctrl+Shift+R) or use a fresh
incognito window. If still old, check the Actions tab of your repo —
deploy may have failed.

### `/api/me` returns 404

The Functions API didn't deploy. In SWA portal → Functions blade —
should see `me`, `state`, `audit`, `users`, `roles`. If empty, the
build failed or the api folder wasn't found at `/api`. Check
the GitHub Actions log.

### `/api/state` returns 500: "Storage is not configured"

`STORAGE_CONNECTION_STRING` is missing or wrong in app settings.
After fixing, the change takes effect within ~1 minute (no rebuild
needed for app settings — they're picked up on next API call).

---

## Part 8 — After everything works

### 8.1 Production hardening (do these eventually)

- **Enable Application Insights** on the SWA for monitoring/alerting.
- **Set a budget alert** on the subscription at $30/month.
- **Switch storage to Managed Identity** (eliminates the connection
  string). See `MIGRATION.md` section 9.
- **Restrict storage networking** to SWA's outbound IPs only.
- **Add a custom domain** (e.g. `cma.onsemi.com`).

### 8.2 Calendar reminders to set NOW

- **22 months from today:** rotate the client secret.
- **Every 90 days:** review user access (who's in `ADMIN_EMAILS`).

### 8.3 Onboarding more users

To add a user as a regular Auditor:
- Just have them sign in. They'll get the default Auditor role and
  read-only access. No admin action needed.

To make someone an Admin:
- SWA → Configuration → edit `ADMIN_EMAILS` to include their email →
  Save.
- That user signs out and signs back in.

To make someone an Assessor:
- Same flow with `ASSESSOR_EMAILS`.

---

## Part 9 — If something goes wrong, how to start over

The beauty of putting everything in one resource group:

1. Azure portal → Resource groups → click yours → **Delete resource
   group** at the top → type the name to confirm → delete.
2. This deletes the SWA, the storage account, and everything else
   in one go. Takes ~5 minutes.
3. Entra app registration is separate: App registrations → click
   yours → Delete.
4. Then start over from Part 1.

You're not stuck. Iteration cycles are cheap.

---

## Appendix — Where everything lives

For mental model:

| Thing | Where it's configured | Where it's stored |
|-------|----------------------|-------------------|
| App code | GitHub repo | Deployed to SWA on push |
| Static Web App resource | Azure portal | Azure |
| Storage container `cma-data` | Azure portal | Azure |
| Entra app registration | Azure portal (Entra blade) | Entra ID |
| Client secret | Generated in app reg | Stored in SWA app settings |
| Tenant/Client ID | Generated in app reg | Used in `staticwebapp.config.json` and SWA app settings |
| Connection string | Generated in storage acct | Stored in SWA app settings |
| `ADMIN_EMAILS` allowlist | SWA Configuration blade | SWA app settings |
| User assessments | (created by users) | `cma-data` blob |
| Audit log | (auto-generated) | `cma-data` blob |
| Login redirect URI | App reg → Authentication | Entra ID |

The browser holds **none** of this. Every browser sees the same
configured app.
