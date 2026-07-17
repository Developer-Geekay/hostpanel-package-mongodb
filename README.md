# hostpanel-mongodb

HostPanel package for provisioning and managing MongoDB on the server.

## Features

- Bundles a lean `mongod` 8.0 binary plus `mongodump`/`mongorestore` for ARM64.
- Databases, users/roles, and backups management from the panel.
- Connection-string helper with **On-server / SSH tunnel / Direct remote** scopes
  and `mongosh`/Node/Python/Compass formats. Strings carry an explicit
  `authSource=<user's home db>`, and when authorization is enforced the panel shows
  the form-based-client rule (set *Authentication Database* to the user's home db —
  GUI "Database" fields usually only pick what to browse, and clients default the
  auth db to `admin`).
- Network access control: authorization enforcement and bind scope, gated so the
  server can never be exposed without credentials.

## Network Access (auth + exposure)

MongoDB ships bound to `127.0.0.1` with authorization **off** — safe because only
the server itself can reach it. Opening it to the network is a two-lock sequence,
enforced in order from the panel header's **🔐 Access** dialog:

1. **Authorization enforcement.** Before flipping it on, the panel mints its own
   `hostpanel_admin` root credential (stored in the core SQLite DB) so panel
   management keeps working; `mongodump`/`mongorestore` and the panel client then
   authenticate with it. After this, **every application must connect with a valid
   username and password.**
2. **Network exposure.** Only once authorization is enforced may the bind widen to
   `0.0.0.0` (all interfaces). The API refuses any request that would leave MongoDB
   both exposed and unauthenticated, and `_write_config` refuses to materialize such
   a config even if the stored settings are inconsistent.

Each change restarts MongoDB and is **rolled back automatically** if the server does
not come back reachable by the panel. All changes are audit-logged.

The security posture (auth flag, bind IP, panel admin credential) lives in the core
DB, not in `mongod.conf` — the package regenerates `mongod.conf` on every
install/update and re-applies the stored posture, so an update can never silently
reset an exposed-with-auth server back to open.

> Direct network exposure additionally requires a router port-forward for `27017`.
> Prefer the **SSH tunnel** connection scope for ad-hoc remote access — it needs no
> exposure at all.

## API

Prefix: `/cpanelapi/mongodb`

```
GET    /status                    running, version, port, bind_ip, auth_enabled
GET    /access                    current auth/bind posture
PUT    /access                    { auth_enabled, bind_ip }  (admin)
GET    /databases  · POST /databases · DELETE /databases/{name} · POST /databases/{name}/clear
GET    /users · POST /users · DELETE /users/{auth_db}/{username} · password/roles routes
GET    /backups · POST /backups · POST /backups/restore · GET /backups/{name}/download
```

## Build & Release

```bash
./build.sh                 # -> hostpanel-mongodb-<version>.zip
```

Bump `plugin/setup.py` to match the tag, push the tag, let the release workflow build
and publish the zip, then update the package through the panel.
