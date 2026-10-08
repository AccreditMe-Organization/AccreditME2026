# Storing AccreditMe files in your SharePoint

**For:** your Microsoft 365 / Entra ID administrators.
**Time needed:** about 20 minutes.
**Result:** AccreditMe can add, read and remove files in **one** SharePoint
document library that you choose, and nowhere else in your Microsoft 365.

AccreditMe never signs in to your Microsoft 365 as a person and never asks for
anyone's password. You create an app registration in your own tenant, give it
access to one library, and hand five values to your AccreditMe administrator.
You stay in control throughout: you can see, change or remove that access at any
time from your own admin centres.

---

## Before you start

You need:

- **A SharePoint site and a document library for AccreditMe.** We recommend a
  library used **only** by AccreditMe — for example a library called
  *AccreditMe Files* on a site called *Quality*. See
  [Why a dedicated library](#why-a-dedicated-library).
- Someone who can **register an app** in Microsoft Entra ID.
- Someone with the **Privileged Role Administrator** or **Global
  Administrator** role, to approve the app's permission. Microsoft does not let
  the Application Administrator or Cloud Application Administrator roles approve
  this kind of permission.
- Someone with the **SharePoint Administrator** role, or an owner of the site, to
  give the app access to the library.

These may all be the same person.

---

## Step 1 — Register the app

1. Sign in to the **Microsoft Entra admin center** (entra.microsoft.com).
2. Go to **Entra ID → App registrations → New registration**.
3. **Name:** `AccreditMe storage` (or any name you will recognise).
4. **Supported account types:** *Accounts in this organizational directory
   only* (single tenant).
5. **Redirect URI:** leave empty. AccreditMe does not sign anyone in through
   this app.
6. Select **Register**.
7. On the app's **Overview** page, copy two values for later:
   - **Directory (tenant) ID**
   - **Application (client) ID**

---

## Step 2 — Add the permission and approve it

1. In the app, go to **API permissions → Add a permission → Microsoft Graph →
   Application permissions**.
2. Search for and tick **`Lists.SelectedOperations.Selected`**, then select
   **Add permissions**.
3. If the app has any other permission listed — for example `User.Read`, which
   new registrations get by default — you may remove it. AccreditMe needs only
   this one.
4. Select **Grant admin consent for *your organisation*** and confirm. This step
   needs a Privileged Role Administrator or Global Administrator.

**This permission on its own gives access to nothing.** It only allows the app
to be given access to specific libraries, one by one, which you do in Step 3.
Until then, the app cannot see any of your sites or files.

> **Already standardised on `Sites.Selected`?** AccreditMe also works with
> **`Sites.Selected`** plus a grant on one **site** instead of one library. It
> gives the app access to every list and library on that site, so we recommend
> the library permission above. If you use `Sites.Selected`, follow
> [the site alternative](#alternative-a-site-grant-with-sitesselected) in
> Step 3 instead.

---

## Step 3 — Give the app write access to the one library

You need the **site** and **library** identifiers, then one request that creates
the grant. Choose **PowerShell** or **Graph Explorer**. Both do exactly the same
thing.

Replace in every example:

- `contoso.sharepoint.com` with your SharePoint host;
- `/sites/Quality` with your site's path;
- `AccreditMe Files` with your library's name;
- `<APPLICATION-CLIENT-ID>` with the Application (client) ID from Step 1.

### Option A — PowerShell (Microsoft Graph PowerShell)

Run these as a SharePoint Administrator, or as an owner of the site:

```powershell
# One-time: install the module if you don't have it.
Install-Module Microsoft.Graph.Sites -Scope CurrentUser

# Sign in. The scope is needed only for this session, to create the grant.
Connect-MgGraph -Scopes "Sites.FullControl.All"

# 1. Find the site and the library.
$site = Get-MgSite -SiteId "contoso.sharepoint.com:/sites/Quality"
$list = Get-MgSiteList -SiteId $site.Id -Filter "displayName eq 'AccreditMe Files'"

# Keep these two lines of output. AccreditMe may ask for them.
"Site ID:    $($site.Id)"
"Library ID: $($list.Id)"

# 2. Give the app write access to that library only.
$params = @{
  roles = @("write")
  grantedToV2 = @{
    application = @{
      id          = "<APPLICATION-CLIENT-ID>"
      displayName = "AccreditMe storage"
    }
  }
}
New-MgSiteListPermission -SiteId $site.Id -ListId $list.Id -BodyParameter $params

Disconnect-MgGraph
```

The last command returns the new permission, with `roles` showing `write`.

### Option B — Graph Explorer, in the browser

1. Open **Graph Explorer** (developer.microsoft.com/graph/graph-explorer) and
   sign in as a SharePoint Administrator or an owner of the site.
2. Select **Modify permissions**, and consent to **`Sites.FullControl.All`**
   for Graph Explorer. This is Graph Explorer's own permission, used only while
   you are signed in; it is not given to the AccreditMe app.
3. Find the site:
   `GET https://graph.microsoft.com/v1.0/sites/contoso.sharepoint.com:/sites/Quality`
   Copy the `id` from the response. This is the **Site ID**.
4. Find the library:
   `GET https://graph.microsoft.com/v1.0/sites/{Site ID}/lists?$filter=displayName eq 'AccreditMe Files'`
   Copy the `id` of the one result. This is the **Library ID**.
5. Create the grant:
   `POST https://graph.microsoft.com/v1.0/sites/{Site ID}/lists/{Library ID}/permissions`
   with this request body:

   ```json
   {
     "roles": ["write"],
     "grantedToV2": {
       "application": { "id": "<APPLICATION-CLIENT-ID>", "displayName": "AccreditMe storage" }
     }
   }
   ```

   A `201 Created` response means it worked.

### Alternative: a site grant with `Sites.Selected`

Only if you chose `Sites.Selected` in Step 2. Run as a **SharePoint
Administrator**, which Microsoft requires for site grants:

```powershell
Connect-MgGraph -Scopes "Sites.FullControl.All"
$site = Get-MgSite -SiteId "contoso.sharepoint.com:/sites/Quality"
$params = @{
  roles = @("write")
  grantedToIdentities = @(@{ application = @{ id = "<APPLICATION-CLIENT-ID>"; displayName = "AccreditMe storage" } })
}
New-MgSitePermission -SiteId $site.Id -BodyParameter $params
Disconnect-MgGraph
```

---

## Step 4 — Create the client secret

1. In the app, go to **Certificates & secrets → Client secrets → New client
   secret**.
2. **Description:** `AccreditMe`.
3. **Expires:** Microsoft allows at most 24 months and recommends less than 12.
   **Note the expiry date:** AccreditMe can remind you 30 days before it.
4. Select **Add**, then copy the secret's **Value** straight away. Copy the
   **Value**, not the *Secret ID*: Microsoft never shows the Value again.

---

## Step 5 — Give these values to your AccreditMe administrator

| AccreditMe asks for | Where you got it |
|---|---|
| **Tenant ID** | Step 1, *Directory (tenant) ID*. Your primary domain, such as `contoso.com`, also works. |
| **Client ID** | Step 1, *Application (client) ID* |
| **Client secret** | Step 4, the secret's *Value* |
| **Site URL** | Your site's address, e.g. `https://contoso.sharepoint.com/sites/Quality` |
| **Library name** | The library's name exactly as shown, e.g. `AccreditMe Files` |
| **Secret expires on** | Step 4. Optional, but it turns on the 30-day reminder. |

**Keep the client secret private.** The best route is for the person who
created it to type it into AccreditMe themselves, if they have an AccreditMe
administrator account. Otherwise share it only through your organisation's
approved channel for secrets, never in a plain email or chat. AccreditMe stores
it encrypted, never shows it again (only "Set"), and never writes it to any log.

In AccreditMe, the administrator chooses **SharePoint**, enters the values and
selects **Test**. The test signs in as the app, finds the site and library,
then writes, reads and deletes a small test file. If a step fails, AccreditMe
says which one and why — for example *"the client secret is invalid or has
expired"* or *"the app can see the library but can't add files"*. When the test
passes, the administrator selects **Confirm**.

**Once confirmed, the tenant, site and library are fixed.** Moving AccreditMe's
files to a different location is done by AccreditMe support. The client ID and
secret can still be replaced at any time (see below).

---

## Good to know

### Why a dedicated library

Giving an app access to one library **breaks permission inheritance on that
library**. This is how SharePoint works, as Microsoft documents: from then on,
changes to the site's permissions no longer flow down to that library. On a
library used only by AccreditMe this doesn't matter; on a busy shared library
it would quietly change how your people's access works.

### What happens to deleted files

When someone deletes a file in AccreditMe, it stays in AccreditMe's own recycle
bin for 30 days and can be restored there. After that, AccreditMe removes it
from your library. **It is then not destroyed: it moves to your SharePoint
recycle bin,** where your own SharePoint retention settings decide when it is
permanently removed. The test file from the connection test ends up there as
well.

### What AccreditMe writes in your library

AccreditMe files sit in an **AccreditMe** folder in the library, organised by
the record they belong to. Please don't rename, move or edit them inside
SharePoint. AccreditMe keeps its own record of each file, including a
fingerprint of its contents.

### Your files don't count against your AccreditMe storage plan

Files stored in your SharePoint are not counted in your AccreditMe plan's
storage limit.

---

## Rotating the client secret

Do this before the old secret expires. AccreditMe reminds its administrators 30
days ahead if the date was entered.

1. In the app, under **Certificates & secrets**, create a **new** client secret.
   Keep the old one for now.
2. Give the new **Value** and its expiry date to your AccreditMe administrator,
   who enters them under **Replace secret**. AccreditMe tests the new secret
   against the same site and library before saving it, and keeps the old one if
   the test fails.
3. Once AccreditMe shows the new secret as saved, **delete the old secret** in
   Entra.

If a secret expires before it is replaced, AccreditMe stops being able to reach
the library. Uploads and downloads of those files pause, and AccreditMe tells
its administrators. Replacing the secret puts everything back; nothing is lost.

---

## Withdrawing AccreditMe's access

You can do this at any time, in any of these ways:

- **Remove the library grant:** list the grants with
  `Get-MgSiteListPermission -SiteId $site.Id -ListId $list.Id`, then remove
  AccreditMe's with
  `Remove-MgSiteListPermission -SiteId $site.Id -ListId $list.Id -PermissionId <id>`.
- **Remove the admin consent:** Entra admin center → **Enterprise apps** → your
  app → **Permissions**.
- **Delete the client secret, or the whole app registration.**

AccreditMe notices within the hour, stops reading and writing, and tells its
administrators. **Your files stay in your library;** nothing is deleted.

To move AccreditMe off SharePoint for good, contact AccreditMe support before
withdrawing access. The files can then be moved first.
