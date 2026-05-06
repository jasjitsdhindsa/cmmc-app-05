# Azure Setup Walkthrough — For First-Time Users

This is a no-prior-knowledge expansion of `MIGRATION.md`. If `MIGRATION.md`
felt like reading a recipe written by someone who assumed you already
know how to cook, this is the version with "first, locate the spatula"
included.

Allow yourself **2 hours** the first time. Most of it is waiting and
clicking through forms. The actual thinking is small.

---

## Things to know before you start

### What is "Azure"?

Azure is Microsoft's cloud. It's a giant pool of computers and
services you can rent by the minute. You'll log in to a website
called the **Azure portal** and click buttons to "create" resources
(things like a website, a database, a storage account). You don't
manage hardware — you describe what you want and Azure spins it up.

### What you'll be creating

Six things, in this order:

1. **A resource group** — a folder that holds the other resources.
   Free. Just a label.
2. **A storage account** — where your assessment data and audit log
   live. About $0.05/month for this app's volume.
3. **A Static Web App** — hosts your website AND your API. The
   "Standard" tier costs ~$9/month; "Free" tier is $0 but limited.
4. **An app registration in Entra ID** — Microsoft's identity
   service. This is what makes "Sign in with Microsoft" work. Free.
5. **Three security groups** in Entra ID — for assigning Admin /
   Assessor / Auditor roles to people. Free.
6. **A client secret** — a password the Static Web App uses to talk
   to Entra ID. Free, but expires every 24 months and must be rotated.

### Three logins you might confuse

- **Azure Portal** — `https://portal.azure.com` — for managing
  resources (storage, web apps, etc.).
- **Microsoft Entra admin center** — `https://entra.microsoft.com` —
  for managing identity (users, groups, app registrations).
- **GitHub** — `https://github.com` — for the source code.

You can do most identity things from the Azure Portal too — Entra ID
appears as a service inside it. We'll mostly stay in the Azure Portal
for simplicity.

### What if you don't have permission?

You may discover partway through that your account can't create
resources, or can't register apps. That's normal in corporate tenants.
When that happens:

- Stop and email your IT/cloud admin team.
- Tell them: "I'm setting up an Azure Static Web App with Entra ID
  authentication. I need [the specific thing you're blocked on]."
- They'll either give you the permission or do the step for you.

---

## Part A — Get your bearings in the Azure Portal

### A.1 Sign in

1. Go to `https://portal.azure.com`.
2. Sign in with your work account (e.g. `you@onsemi.com`).
3. You'll land on a homepage with tiles. Don't worry about most of
   them. The two parts you'll use:
   - **The search bar at the very top** — type what you want and
     press Enter. This is by far the fastest way to find anything.
   - **The hamburger menu (☰) at the top-left** — opens the
     all-services panel. Useful occasionally.

### A.2 Verify your subscription

A "subscription" is the billing container. Resources live inside one.
You may have several available; pick the right one.

1. In the search bar, type `Subscriptions` and click the result.
2. You'll see a list. If it's empty, you don't have access to any
   subscription — stop here and ask your admin. If it has one or
   more, note the name of the one you intend to use (something like
   "onsemi-dev-eastus2" or "Visual Studio Enterprise"). You'll
   pick this from a dropdown several times in the steps below.

### A.3 Pick your region

Pick one Azure region and use it for everything (storage, web app,
etc.). Resources in the same region are faster and cheaper to
connect. Pick the region geographically closest to your users — for
US-based teams, **East US 2** or **Central US** are reasonable
defaults.

> Write your choice down. Subscription name + region — you'll use
> these every time you create something.

---

## Part B — Create the resource group

A resource group is a folder. Free. Used to keep everything
together so you can delete the whole thing in one click later if you
want to start over.

1. Search bar → `Resource groups` → click the result.
2. Click **+ Create** (top-left).
3. Form fields:
   - **Subscription**: pick the one from A.2.
   - **Resource group**: type a name. Use something descriptive
     like `cma-prod-rg` or `cma-test-rg`. Lowercase, no spaces.
   - **Region**: pick your region from A.3.
4. Click **Review + create** at the bottom. Then **Create**.
5. Wait ~30 seconds for "Your deployment is complete."

✅ **Checkpoint:** the search bar should now show your resource group
name when you search for it. If it doesn't, refresh the portal.

---

## Part C — Create the storage account

This holds the JSON files (assessments, audit log, owners, users).

### C.1 Create the storage account itself

1. Search bar → `Storage accounts` → click the result.
2. Click **+ Create**.
3. **Basics** tab:
   - **Subscription**: same as before.
   - **Resource group**: pick the one from Part B.
   - **Storage account name**: must be **lowercase, no spaces, max
     24 characters, globally unique** across all of Azure. Suggestion:
     `cmastorage` + a few digits, e.g. `cmastorageprod01`. If the
     name's taken, you'll see a red warning — try another.
   - **Region**: same as before.
   - **Performance**: leave on **Standard**.
   - **Redundancy**: change to **LRS (Locally-redundant storage)**.
     This is the cheapest. The default GRS replicates to a second
     region, which costs more and you don't need it.
4. Click **Next: Advanced**. Defaults are fine.
5. Click **Next: Networking**. Leave on "Enable public access from
   all networks" for now. (Later, after everything works, you can
   restrict this for security. See `MIGRATION.md` section 9.)
6. Click **Next: Data protection**. Defaults are fine.
7. Click **Next: Encryption**. Defaults are fine.
8. Click **Review + create**. Then **Create**.
9. Wait 1–2 minutes for "Your deployment is complete."
10. Click **Go to resource**.

### C.2 Create the container

A "container" is a sub-folder inside the storage account.

1. On the storage account's left navigation menu, find **Data
   storage → Containers**.
2. Click **+ Container** at the top.
3. **Name**: type exactly `cma-data` (lowercase, with the hyphen).
4. **Anonymous access level**: leave on **Private (no anonymous
   access)**. This is critical — you don't want the world reading
   your audit log.
5. Click **Create**.

### C.3 Upload the seed data

The two JSON files from your project (`cma-assessments.json` and
`cma-audit.json`) need to live in this container.

1. Click on the `cma-data` container you just created.
2. Click **Upload** at the top.
3. Click **Browse for files** (or drag and drop).
4. Pick `cma-assessments.json` from the zip you extracted.
5. Click **Upload**.
6. Repeat for `cma-audit.json`.
7. After both are uploaded, the container should show 2 blobs.

> **Important:** the file names must match exactly. The API code
> looks for `cma-assessments.json` and `cma-audit.json` — if you
> renamed them or used different capitalization, the app will
> appear empty when you sign in.

### C.4 Copy the connection string

A "connection string" is a long line of text that contains the
storage account name plus a secret key. The Static Web App's API
will use it to talk to storage.

1. Go back to the storage account (use breadcrumb or hamburger
   menu).
2. On the left nav, find **Security + networking → Access keys**.
3. You'll see "key1" with a "Connection string" field that's hidden
   behind a **Show** button. Click **Show**.
4. Click the copy icon next to the connection string.
5. **Paste it somewhere safe immediately** — Notepad is fine. You'll
   need it in Part F.

The string looks like:
```
DefaultEndpointsProtocol=https;AccountName=cmastorageprod01;AccountKey=k7H2...long-base64-blob...==;EndpointSuffix=core.windows.net
```

> **Treat this like a password.** Anyone with this string has full
> access to your storage. Don't email it, don't paste it in chat,
> don't commit it to GitHub.

✅ **Checkpoint:** you have a storage account with a `cma-data`
container holding two JSON files, and you've copied a connection
string that begins with `DefaultEndpointsProtocol=`.

---

## Part D — Create the three Entra ID security groups

These are the groups that decide who is an Admin / Assessor / Auditor
in the app.

### D.1 Get to the Groups blade

1. Search bar → `Microsoft Entra ID` (or just `Entra`) → click the
   result.
2. On the left nav of Entra ID, click **Groups**.

> If you see "You don't have permission" or the Groups option is
> missing — your account isn't a Group Administrator. Ask your IT
> admin to either grant you the role or create these three groups
> for you.

### D.2 Create the first group: CMA-Admins

1. Click **+ New group** at the top.
2. Form fields:
   - **Group type**: `Security`.
   - **Group name**: `CMA-Admins`.
   - **Group description**: "App admins for Cybersecurity Maturity
     Assessment".
   - **Membership type**: `Assigned`.
   - **Owners**: click "No owners selected" and add yourself.
   - **Members**: click "No members selected" and add yourself
     (you need to be in this group so you can sign in as admin
     after deployment).
3. Click **Create** at the bottom.
4. Wait ~30 seconds, then refresh the groups list.

### D.3 Repeat for the other two groups

Do D.2 again twice, with these names. You don't need to add members
to these yet — you can do that later when you onboard people.

- `CMA-Assessors` — description "App assessors who edit scores".
- `CMA-Auditors` — description "App auditors with read-only
  access".

### D.4 Copy the three Object IDs

Each group has a unique GUID called its "Object ID". The Static Web
App needs all three.

1. Click on `CMA-Admins`.
2. On the **Overview** blade, find **Object ID** (a GUID that looks
   like `e9792d7b-eab7-4d2d-8c4a-cd5756abd2d0`).
3. Click the copy icon. Paste it in Notepad with a label:
   ```
   CMA-Admins:    e9792d7b-eab7-4d2d-8c4a-cd5756abd2d0
   ```
4. Repeat for `CMA-Assessors` and `CMA-Auditors`.

✅ **Checkpoint:** Notepad now contains three labeled GUIDs.

---

## Part E — Register the app in Entra ID

This step tells Entra ID "there's a web app called CMA, and when its
users sign in, here's the rules." It produces three values you need:
client ID, tenant ID, and a client secret.

### E.1 Create the registration

1. Search bar → `App registrations` → click the result.
2. Click **+ New registration**.
3. Form fields:
   - **Name**: `CMA - Cybersecurity Maturity Assessment`.
   - **Supported account types**: pick **Accounts in this
     organizational directory only (Single tenant)**. (Pick
     multitenant only if external partners outside onsemi need to
     sign in.)
   - **Redirect URI**: leave blank for now. We'll fill this in
     after the Static Web App is created in Part F.
4. Click **Register** at the bottom.
5. You're taken to the new app registration's Overview page.

### E.2 Copy two GUIDs

On this Overview page:

1. Find **Application (client) ID** — a GUID. Copy it. In Notepad:
   ```
   AAD_CLIENT_ID: <paste GUID here>
   ```
2. Find **Directory (tenant) ID** — another GUID. Copy it. In
   Notepad:
   ```
   AAD_TENANT_ID: <paste GUID here>
   ```

### E.3 Create a client secret

A "secret" is a password that the Static Web App will use to prove
to Entra ID that it really is the registered app.

1. On the left nav of the app registration, click **Certificates &
   secrets**.
2. Click **+ New client secret**.
3. **Description**: `swa-auth`.
4. **Expires**: choose **24 months** (the maximum). Set yourself a
   calendar reminder for ~22 months from now to rotate this.
5. Click **Add**.
6. **Critical:** the secret's **Value** is shown ONCE, on this
   screen, right after creation. Click the copy icon next to
   "Value" and paste into Notepad immediately:
   ```
   AAD_CLIENT_SECRET: <paste long string here>
   ```
   Do NOT copy "Secret ID" — that's a different field. You want
   "Value".

> If you navigate away before copying, the value disappears
> forever. You'll have to delete the secret and create a new one.

### E.4 Configure the groups claim

This tells Entra ID to include the user's group memberships in the
sign-in token, so the API can decide who's an admin.

1. Left nav → **Token configuration**.
2. Click **+ Add groups claim**.
3. Tick **Security groups**.
4. Under "Customize token properties by type", make sure **ID**,
   **Access**, and **SAML** are all set to **Group ID** (not "sAMAccountName").
5. Click **Add** at the bottom.

✅ **Checkpoint:** Notepad now has three values labeled
`AAD_CLIENT_ID`, `AAD_TENANT_ID`, `AAD_CLIENT_SECRET`, plus the
three group object IDs from Part D.

---

## Part F — Create the Static Web App

This is the big one — it creates the website and pulls code from
GitHub.

### F.1 Make sure your code is in a GitHub repo

The Static Web App connects to a GitHub repo and rebuilds whenever
you push. If your code isn't there yet, follow my earlier
instructions to upload the `cma-rearchitected` zip contents to
GitHub. The Static Web App needs your repo to exist before you can
create it.

### F.2 Create the resource

1. Search bar → `Static Web Apps` → click the result.
2. Click **+ Create**.
3. **Basics** tab:
   - **Subscription**: same as before.
   - **Resource group**: pick the one from Part B.
   - **Name**: `cma-app` (or whatever you like — this is just a
     resource name).
   - **Plan type**: pick **Standard**. (Free tier works for testing
     but lacks SLA. For a compliance app, pay for Standard.)
   - **Region** for the API: pick the closest one to your storage
     account region.
4. **Deployment details**:
   - **Source**: pick **GitHub**.
   - Click **Sign in with GitHub** if prompted, and authorize
     Azure to read your repos.
   - **Organization**: pick your GitHub org/account.
   - **Repository**: pick your CMA repo.
   - **Branch**: pick `main` (or whichever branch holds your code).
5. **Build details**:
   - **Build presets**: pick **Custom**.
   - **App location**: type `/`.
   - **API location**: type `/api`.
   - **Output location**: leave blank.
6. Click **Review + create**. Then **Create**.
7. Wait 2–3 minutes. Click **Go to resource**.

### F.3 Wait for the first deployment

Azure automatically commits a GitHub Actions workflow file to your
repo and triggers the first build.

1. On your Static Web App's Overview blade, find the **URL** field
   near the top — it'll be something like
   `https://proud-river-0abc1234.5.eastus2.azurestaticapps.net`.
   **Copy this URL** to Notepad — you need it for the next step.
2. To watch the build progress, click the **Deployment history** tab
   (or go to your GitHub repo → Actions tab). The first build
   takes 3–5 minutes.

> If the build fails, click into the failed run on GitHub to see
> the log. Common causes: missing `package.json` in `/api`,
> Node version mismatch (the workflow tries Node 20 by default).

### F.4 Set the redirect URI back on the app registration

Now that you have the Static Web App's URL, you can complete the
app registration setup.

1. Search bar → `App registrations` → click your `CMA -
   Cybersecurity Maturity Assessment` app.
2. Left nav → **Authentication**.
3. Click **+ Add a platform**.
4. Pick **Web**.
5. **Redirect URIs**: paste your Static Web App URL plus
   `/.auth/login/aad/callback`. Example:
   ```
   https://proud-river-0abc1234.5.eastus2.azurestaticapps.net/.auth/login/aad/callback
   ```
   Note the leading dot in `/.auth` — that's correct.
6. Under "Implicit grant and hybrid flows", tick **ID tokens**.
7. Click **Configure** at the bottom.

✅ **Checkpoint:** the app registration's Authentication blade
shows one Web platform with one redirect URI.

---

## Part G — Set the application settings

This is where the values from Notepad come together.

1. Go back to your Static Web App resource.
2. Left nav → **Settings → Environment variables** (older portals
   may call this "Configuration").
3. You'll see a tab called **Application settings**. Click
   **+ Add application setting** for each of the following:

| Name (paste exactly)            | Value                                              |
| ------------------------------- | -------------------------------------------------- |
| `AAD_CLIENT_ID`                 | The client ID GUID from E.2                        |
| `AAD_CLIENT_SECRET`             | The secret value from E.3                          |
| `AAD_TENANT_ID`                 | The tenant ID GUID from E.2                        |
| `STORAGE_CONNECTION_STRING`     | The connection string from C.4                     |
| `STORAGE_CONTAINER_NAME`        | `cma-data`                                         |
| `ROLE_MAP_ADMIN`                | The CMA-Admins object ID from D.4                  |
| `ROLE_MAP_ASSESSOR`             | The CMA-Assessors object ID from D.4               |
| `ROLE_MAP_AUDITOR`              | The CMA-Auditors object ID from D.4                |

For each row: click **+ Add**, paste the name on the left, paste
the value on the right, click **OK**.

**After all 8 are added**, click **Save** at the top. Wait for
"Application settings saved successfully."

> **Optional fallback** — if you don't want to manage Entra groups
> at first, also add `ADMIN_EMAILS` with your own email as the
> value. Whoever has an email in this list is treated as an admin
> regardless of group membership. Useful as a backup while you
> figure out the group plumbing.

---

## Part H — Patch the staticwebapp.config.json with your tenant ID

The config file in your repo has a placeholder string `AAD_TENANT_ID`
that needs to be replaced with the real GUID. Why this one isn't
done from app settings: SWA does not substitute environment
variables in the `openIdIssuer` URL — it must contain the literal
GUID.

1. Go to your repo on GitHub.
2. Click `staticwebapp.config.json`.
3. Click the pencil icon (top-right of the file view) to edit.
4. Find this line near the top:
   ```json
   "openIdIssuer": "https://login.microsoftonline.com/AAD_TENANT_ID/v2.0",
   ```
5. Replace **only** the literal string `AAD_TENANT_ID` (in the
   middle of the URL) with your tenant ID GUID. The result should
   look like:
   ```json
   "openIdIssuer": "https://login.microsoftonline.com/12345678-abcd-...-...-............/v2.0",
   ```
6. Scroll down. Commit message: "Wire openIdIssuer to tenant".
7. Click **Commit changes**.
8. Azure rebuilds automatically. Watch the GitHub Actions tab for
   the build to finish (~3 minutes).

---

## Part I — First sign-in

Once the new build finishes:

1. Open a fresh browser window (not incognito — the redirect cookies
   need to work).
2. Go to your Static Web App URL (e.g.
   `https://proud-river-0abc1234.5.eastus2.azurestaticapps.net`).
3. You should see the app's login page with a single "Sign in with
   Microsoft" button.
4. Click it. Microsoft's login page opens. Sign in with the same
   email you added to `CMA-Admins` in D.2.
5. After consenting (first time only), you're redirected back to
   the app.

You should land on the dashboard. Open **Settings → Diagnostics →
Test API & Auth**. It should say:
> ✓ Authenticated as you@onsemi.com (role: Admin). The API is
> reachable and your Entra ID session is valid.

---

## Troubleshooting — the things that actually go wrong

I've put the problems in the order they typically happen.

### "AADSTS50011: The reply URL specified in the request does not match"

You forgot Part F.4 or you typed the URL wrong. The redirect URI on
the app registration must be **exactly**
`https://YOUR-SWA-URL/.auth/login/aad/callback` — note the leading
dot in `/.auth`, and `/callback` at the end. No trailing slash.

### Login works, but the page is blank or shows "Verifying session…" forever

DevTools tells you the truth fast:
1. In your browser, press F12 to open developer tools.
2. Click the **Network** tab.
3. Refresh the page.
4. Look for the request to `/api/me`. Click it.
5. The **Response** tab shows the actual error.

Common responses:
- `401 Not signed in` — your sign-in didn't actually complete. Try
  signing out at `/.auth/logout` and back in.
- `500 Storage is not configured` — `STORAGE_CONNECTION_STRING` is
  unset or wrong. Recheck Part G.
- `500 ... AuthorizationFailed` — connection string is correct but
  the storage account's network firewall is blocking. Either set
  storage networking back to "All networks" temporarily, or follow
  `MIGRATION.md` section 9 to add the SWA's outbound IPs.

### Login works but my role is "Auditor" when it should be "Admin"

The `groups` claim is missing or `ROLE_MAP_ADMIN` doesn't match.
Quick test: set the `ADMIN_EMAILS` app setting to your email
(no spaces, lowercase) and sign out / back in. If you're now Admin,
the email fallback works and the group claim is the broken bit.
Recheck E.4 (groups claim configuration).

### "Your administrator has not consented to use the application"

Your Entra tenant requires admin consent for new apps. Either:
- Have an Entra ID admin go to your app registration → **API
  permissions** → click **Grant admin consent for [tenant]**, OR
- Ask the admin to grant consent and try again.

### The site shows old data after I changed something

Browser caching. Hard-reload with **Ctrl+Shift+R** (Windows) or
**Cmd+Shift+R** (Mac).

### I made a mess and want to start over

The beauty of putting everything in one resource group: delete the
group, everything goes with it (storage, SWA, deployments). The
Entra app registration and groups are separate — delete those
manually if needed (Entra → App registrations → your app →
Delete; Entra → Groups → each group → Delete).

---

## Cost expectations

For a small team (under 50 users):

| Resource         | Tier                         | Approx. monthly cost  |
| ---------------- | ---------------------------- | --------------------- |
| Static Web App   | Standard                     | ~$9                   |
| Storage account  | Standard LRS, ~50 MB data    | <$0.10                |
| Entra ID         | Free (default tier)          | $0                    |
| **Total**        |                              | **~$10/month**        |

If cost is a concern, use the Static Web App Free tier — it works
identically but has no SLA and lower API timeouts. You can switch
between Free and Standard later via the SWA's **Pricing tier**
blade.

---

## A reasonable order of operations checklist

Print this and tick off as you go.

```
PART A — Bearings
[ ] Signed in to portal.azure.com
[ ] Confirmed subscription name: ___________________
[ ] Picked region: ___________________

PART B — Resource group
[ ] Created resource group named: ___________________

PART C — Storage
[ ] Created storage account named: ___________________
[ ] Created container "cma-data"
[ ] Uploaded cma-assessments.json
[ ] Uploaded cma-audit.json
[ ] Copied connection string to Notepad

PART D — Entra groups
[ ] Created CMA-Admins (Object ID: ___________________)
[ ] Added myself to CMA-Admins
[ ] Created CMA-Assessors (Object ID: ___________________)
[ ] Created CMA-Auditors (Object ID: ___________________)

PART E — App registration
[ ] Registered app
[ ] Copied AAD_CLIENT_ID: ___________________
[ ] Copied AAD_TENANT_ID: ___________________
[ ] Created client secret
[ ] Copied AAD_CLIENT_SECRET (the Value, not the ID)
[ ] Configured groups claim (ID + Access + SAML, Group ID)

PART F — Static Web App
[ ] Code is in GitHub repo
[ ] Created Static Web App
[ ] Copied SWA URL: ___________________
[ ] First build succeeded
[ ] Added redirect URI on app registration
[ ] Ticked ID tokens

PART G — App settings
[ ] AAD_CLIENT_ID
[ ] AAD_CLIENT_SECRET
[ ] AAD_TENANT_ID
[ ] STORAGE_CONNECTION_STRING
[ ] STORAGE_CONTAINER_NAME = cma-data
[ ] ROLE_MAP_ADMIN
[ ] ROLE_MAP_ASSESSOR
[ ] ROLE_MAP_AUDITOR
[ ] Clicked Save

PART H — Tenant ID in config
[ ] Edited staticwebapp.config.json on GitHub
[ ] Replaced literal "AAD_TENANT_ID" with real GUID
[ ] Build re-ran successfully

PART I — Test
[ ] Browsed to SWA URL
[ ] "Sign in with Microsoft" button appears
[ ] Sign-in succeeded
[ ] Settings → Diagnostics → Test API & Auth says "Admin"
```

When everything is ticked, you're live.

---

## What to ask your IT team if you get stuck on permissions

Copy-paste-friendly templates:

**To request Azure access:**
> I need Contributor access to an Azure subscription to deploy a
> Static Web App. The app is "CMA" — it tracks our cybersecurity
> maturity assessments. It will use about $10/month of resources.
> Subscription/resource-group preference: [your team's standard].

**To request Entra ID permissions:**
> I need to register a new application in our Entra ID tenant for
> a cybersecurity assessment tool. Specifically:
> - permission to create an app registration (or please create it
>   for me with a redirect URI of
>   https://[my-swa-url]/.auth/login/aad/callback);
> - permission to create three security groups (CMA-Admins,
>   CMA-Assessors, CMA-Auditors);
> - admin consent for the new app to use sign-in (User.Read).

If your admin asks for documentation, send them this file plus
`MIGRATION.md` and `README.md`.
