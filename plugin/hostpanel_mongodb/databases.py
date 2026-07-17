import io
import logging
import os
import re
import subprocess
import tarfile
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from auth import User
from deps import require_admin

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/cpanelapi/mongodb", tags=["MongoDB"])

CONF_FILE   = "/opt/hostpanel/plugins/mongodb/mongod.conf"
BACKUP_DIR  = "/opt/hostpanel/plugins/mongodb/backups"
MONGOD_BIN  = "/opt/hostpanel/plugins/mongodb/mongod"
SYSTEM_DBS  = {"admin", "config", "local"}
DB_NAME_RE  = re.compile(r"^[a-zA-Z0-9_-]{1,38}$")
USER_RE     = re.compile(r"^[a-zA-Z0-9_.\-]{1,32}$")
ALLOWED_ROLES = {"read", "readWrite", "dbAdmin", "dbOwner"}


def _get_port() -> int:
    try:
        with open(CONF_FILE) as f:
            for line in f:
                line = line.strip()
                if line.startswith("port:"):
                    return int(line.split(":", 1)[1].strip())
    except Exception:
        pass
    return 27017


def _get_bind_ip() -> str:
    try:
        with open(CONF_FILE) as f:
            for line in f:
                line = line.strip()
                if line.startswith("bindIp:"):
                    return line.split(":", 1)[1].strip()
    except Exception:
        pass
    return "127.0.0.1"


def _auth_enabled() -> bool:
    """True when mongod.conf enables security.authorization — without it,
    credentials are not enforced and the server must stay loopback-only."""
    try:
        with open(CONF_FILE) as f:
            in_security = False
            for line in f:
                stripped = line.strip()
                if stripped.startswith("security:"):
                    in_security = True
                    continue
                if in_security:
                    if line[:1] not in (" ", "\t"):
                        in_security = False
                        continue
                    if stripped.startswith("authorization:"):
                        return stripped.split(":", 1)[1].strip().lower() == "enabled"
    except Exception:
        pass
    return False


def _client():
    port = _get_port()
    try:
        from pymongo import MongoClient
        c = MongoClient(f"mongodb://localhost:{port}/", serverSelectionTimeoutMS=3000)
        c.admin.command("ping")
        return c
    except ImportError:
        raise HTTPException(503, "pymongo is not installed")
    except Exception as e:
        raise HTTPException(503, f"Cannot connect to MongoDB: {e}")


# ── Status / Count ────────────────────────────────────────────────────────────

@router.get("/status")
async def get_status(_: User = Depends(require_admin)):
    port = _get_port()
    base = {
        "port": port,
        "bind_ip": _get_bind_ip(),
        "auth_enabled": _auth_enabled(),
    }
    try:
        from pymongo import MongoClient
        c = MongoClient(f"mongodb://localhost:{port}/", serverSelectionTimeoutMS=2000)
        info = c.server_info()
        c.close()
        return {"running": True, "version": info.get("version"), **base}
    except Exception:
        return {"running": False, "version": None, **base}


@router.get("/count")
async def db_count(_: User = Depends(require_admin)):
    try:
        from pymongo import MongoClient
        port = _get_port()
        c = MongoClient(f"mongodb://localhost:{port}/", serverSelectionTimeoutMS=2000)
        count = len([d for d in c.list_database_names() if d not in SYSTEM_DBS])
        c.close()
        return {"count": count}
    except Exception:
        return {"count": 0}


# ── Databases ─────────────────────────────────────────────────────────────────

@router.get("/databases")
async def list_databases(_: User = Depends(require_admin)):
    c = _client()
    try:
        names = [d for d in c.list_database_names() if d not in SYSTEM_DBS]
        result = []
        for name in names:
            try:
                stats = c[name].command("dbStats")
                size = stats.get("dataSize", 0)
                collections = stats.get("collections", 0)
            except Exception:
                size = 0
                collections = 0
            result.append({"name": name, "size": size, "collections": collections})
        return result
    finally:
        c.close()


class CreateDbRequest(BaseModel):
    name: str


@router.post("/databases")
async def create_database(body: CreateDbRequest, _: User = Depends(require_admin)):
    name = body.name.strip()
    if not DB_NAME_RE.match(name):
        raise HTTPException(400, "Invalid database name. Use letters, numbers, underscores, hyphens (max 38 chars).")
    if name in SYSTEM_DBS:
        raise HTTPException(400, "Cannot create a system database.")
    c = _client()
    try:
        if name in c.list_database_names():
            raise HTTPException(409, f"Database '{name}' already exists.")
        c[name].create_collection("_init")
        return {"ok": True, "name": name}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))
    finally:
        c.close()


@router.delete("/databases/{name}")
async def drop_database(name: str, _: User = Depends(require_admin)):
    if name in SYSTEM_DBS:
        raise HTTPException(400, "Cannot drop a system database.")
    c = _client()
    try:
        # Revoke roles scoped to this database from all users; preserve the users themselves
        try:
            all_users = c.admin.command("usersInfo", {"forAllDBs": True})
            for u in all_users.get("users", []):
                roles_to_revoke = [
                    r for r in u.get("roles", [])
                    if isinstance(r, dict) and r.get("db") == name
                ]
                if roles_to_revoke:
                    try:
                        c[u["db"]].command("revokeRolesFromUser", u["user"], roles=roles_to_revoke)
                    except Exception:
                        pass
        except Exception:
            pass
        c.drop_database(name)
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))
    finally:
        c.close()


@router.post("/databases/{name}/clear")
async def clear_database(name: str, _: User = Depends(require_admin)):
    if name in SYSTEM_DBS:
        raise HTTPException(400, "Cannot clear a system database.")
    c = _client()
    try:
        db = c[name]
        for coll in db.list_collection_names():
            if not coll.startswith("system."):
                db[coll].drop()
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, str(e))
    finally:
        c.close()


# ── Users ─────────────────────────────────────────────────────────────────────

@router.get("/users")
async def list_all_users(_: User = Depends(require_admin)):
    c = _client()
    try:
        result = c.admin.command("usersInfo", {"forAllDBs": True})
        users = []
        for u in result.get("users", []):
            if u.get("db") in SYSTEM_DBS:
                continue
            roles = [
                {"role": r.get("role", ""), "db": r.get("db", "")}
                for r in u.get("roles", [])
                if isinstance(r, dict)
            ]
            users.append({"username": u["user"], "auth_db": u["db"], "roles": roles})
        return users
    except Exception as e:
        raise HTTPException(500, str(e))
    finally:
        c.close()


class CreateUserRequest(BaseModel):
    username: str
    password: str
    auth_db: str
    role: str = "readWrite"


@router.post("/users")
async def create_user(body: CreateUserRequest, _: User = Depends(require_admin)):
    username = body.username.strip()
    if not username or not USER_RE.match(username):
        raise HTTPException(400, "Invalid username. Use letters, numbers, underscores, dots, hyphens (max 32 chars).")
    if not body.password:
        raise HTTPException(400, "Password is required.")
    auth_db = body.auth_db.strip()
    if not auth_db or auth_db in SYSTEM_DBS:
        raise HTTPException(400, "Invalid authentication database.")
    if body.role not in ALLOWED_ROLES:
        raise HTTPException(400, f"Role must be one of: {', '.join(sorted(ALLOWED_ROLES))}")
    c = _client()
    try:
        c[auth_db].command(
            "createUser", username,
            pwd=body.password,
            roles=[{"role": body.role, "db": auth_db}],
        )
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, str(e))
    finally:
        c.close()


@router.delete("/users/{auth_db}/{username}")
async def delete_user(auth_db: str, username: str, _: User = Depends(require_admin)):
    c = _client()
    try:
        c[auth_db].command("dropUser", username)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, str(e))
    finally:
        c.close()


class ChangePasswordRequest(BaseModel):
    password: str


@router.put("/users/{auth_db}/{username}/password")
async def change_password(
    auth_db: str, username: str, body: ChangePasswordRequest, _: User = Depends(require_admin)
):
    if not body.password:
        raise HTTPException(400, "Password is required.")
    c = _client()
    try:
        c[auth_db].command("updateUser", username, pwd=body.password)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, str(e))
    finally:
        c.close()


class RoleRequest(BaseModel):
    db: str
    role: str


@router.post("/users/{auth_db}/{username}/roles")
async def grant_role(auth_db: str, username: str, body: RoleRequest, _: User = Depends(require_admin)):
    if body.role not in ALLOWED_ROLES:
        raise HTTPException(400, f"Role must be one of: {', '.join(sorted(ALLOWED_ROLES))}")
    c = _client()
    try:
        c[auth_db].command("grantRolesToUser", username, roles=[{"role": body.role, "db": body.db}])
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, str(e))
    finally:
        c.close()


@router.delete("/users/{auth_db}/{username}/roles/{role_db}/{role_name}")
async def revoke_role(
    auth_db: str, username: str, role_db: str, role_name: str, _: User = Depends(require_admin)
):
    c = _client()
    try:
        c[auth_db].command("revokeRolesFromUser", username, roles=[{"role": role_name, "db": role_db}])
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, str(e))
    finally:
        c.close()


# ── Backups ───────────────────────────────────────────────────────────────────

def _mongodump_bin():
    candidates = [
        os.path.join(os.path.dirname(MONGOD_BIN), "mongodump"),
        "/usr/bin/mongodump",
        "/usr/local/bin/mongodump",
    ]
    for p in candidates:
        if os.path.isfile(p) and os.access(p, os.X_OK):
            return p
    return None


def _mongorestore_bin():
    candidates = [
        os.path.join(os.path.dirname(MONGOD_BIN), "mongorestore"),
        "/usr/bin/mongorestore",
        "/usr/local/bin/mongorestore",
    ]
    for p in candidates:
        if os.path.isfile(p) and os.access(p, os.X_OK):
            return p
    return None


@router.get("/backups")
async def list_backups(_: User = Depends(require_admin)):
    tool = _mongodump_bin()
    backups = []
    if os.path.isdir(BACKUP_DIR):
        for entry in sorted(os.listdir(BACKUP_DIR), reverse=True):
            full = os.path.join(BACKUP_DIR, entry)
            if os.path.isdir(full):
                stat = os.stat(full)
                backups.append({
                    "name": entry,
                    "created_at": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
                    "db": None if entry.startswith("full_") else entry.split("_")[0],
                })
    return {"tool_available": tool is not None, "backups": backups}


class BackupRequest(BaseModel):
    db: Optional[str] = None  # None = full backup


@router.post("/backups")
async def create_backup(body: BackupRequest, _: User = Depends(require_admin)):
    tool = _mongodump_bin()
    if not tool:
        raise HTTPException(501, "mongodump not found. Place the mongodump binary alongside mongod in /opt/hostpanel/plugins/mongodb/.")
    port = _get_port()
    os.makedirs(BACKUP_DIR, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    prefix = f"{body.db}_{ts}" if body.db else f"full_{ts}"
    out_dir = os.path.join(BACKUP_DIR, prefix)
    cmd = [tool, f"--port={port}", f"--out={out_dir}"]
    if body.db:
        if body.db in SYSTEM_DBS:
            raise HTTPException(400, "Cannot backup a system database.")
        cmd += ["--db", body.db]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        if r.returncode != 0:
            raise HTTPException(500, f"mongodump failed: {r.stderr.strip() or r.stdout.strip()}")
        return {"ok": True, "name": prefix}
    except subprocess.TimeoutExpired:
        raise HTTPException(500, "Backup timed out.")


class RestoreRequest(BaseModel):
    name: str
    drop: bool = False


@router.post("/backups/restore")
async def restore_backup(body: RestoreRequest, _: User = Depends(require_admin)):
    tool = _mongorestore_bin()
    if not tool:
        raise HTTPException(501, "mongorestore not found.")
    backup_path = os.path.join(BACKUP_DIR, body.name)
    if not os.path.isdir(backup_path):
        raise HTTPException(404, f"Backup '{body.name}' not found.")
    port = _get_port()
    cmd = [tool, f"--port={port}", backup_path]
    if body.drop:
        cmd.append("--drop")
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        if r.returncode != 0:
            raise HTTPException(500, f"mongorestore failed: {r.stderr.strip() or r.stdout.strip()}")
        return {"ok": True}
    except subprocess.TimeoutExpired:
        raise HTTPException(500, "Restore timed out.")


@router.get("/backups/{name}/download")
async def download_backup(name: str, _: User = Depends(require_admin)):
    if ".." in name or "/" in name:
        raise HTTPException(400, "Invalid backup name.")
    backup_path = os.path.join(BACKUP_DIR, name)
    if not os.path.isdir(backup_path):
        raise HTTPException(404, "Backup not found.")

    def generate():
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode="w:gz") as tar:
            tar.add(backup_path, arcname=name)
        buf.seek(0)
        while True:
            chunk = buf.read(65536)
            if not chunk:
                break
            yield chunk

    return StreamingResponse(
        generate(),
        media_type="application/gzip",
        headers={"Content-Disposition": f'attachment; filename="{name}.tar.gz"'},
    )


@router.delete("/backups/{name}")
async def delete_backup(name: str, _: User = Depends(require_admin)):
    if ".." in name or "/" in name:
        raise HTTPException(400, "Invalid backup name.")
    backup_path = os.path.join(BACKUP_DIR, name)
    if not os.path.isdir(backup_path):
        raise HTTPException(404, "Backup not found.")
    import shutil
    shutil.rmtree(backup_path)
    return {"ok": True}
