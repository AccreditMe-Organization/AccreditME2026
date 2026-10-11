# Viewing AccreditMe files kept in your MinIO

**For:** the administrators of the MinIO server your organisation connected to
AccreditMe.
**Time needed:** a few minutes.
**Result:** people can open PDFs, images, text and CSV files inside AccreditMe,
not only download them.

---

## Why this is needed

When someone opens a file in AccreditMe's viewer, **their browser** reads the
file straight from your MinIO, using a link that is valid for fifteen minutes.
The file never passes through AccreditMe's servers.

A browser reads a file from another address only if that server says it may.
MinIO says so with its **CORS** setting. MinIO's default allows every address,
so nothing needs doing **unless** your administrators have restricted it.

If it is restricted, the viewer shows *"This file can't be previewed from your
organization's storage"*. **Download still works**, because a download is not a
browser read from another address.

---

## What to allow

Allow your organisation's AccreditMe address, for example:

```
https://al-nakheel.accreditme.app
```

Only `GET` requests are made, and no cookies or passwords are sent: the link
itself is the permission, for fifteen minutes.

With the MinIO client (`mc`), the server-wide setting is:

```
mc admin config set <your-alias> api cors_allow_origin="https://<your-organisation>.accreditme.app"
mc admin service restart <your-alias>
```

If you already allow other addresses, keep them in the same setting, separated
by commas. The exact command can differ between MinIO versions; your version's
documentation for `api cors_allow_origin` is the authority.

---

## What AccreditMe never does

AccreditMe never streams your MinIO files through its own servers to show them
(Ahmad, 10 Oct, decision D3). If the CORS setting does not allow it, the file
is simply not previewed.
