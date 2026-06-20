import logging
import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import User
from deps import require_admin

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/cpanelapi/mongodb", tags=["MongoDB"])

SYSTEM_DBS = {"admin", "config", "local"}
DB_NAME_RE = re.compile(r"^[a-zA-Z0-9_-]{1,38}$")


def _client():
    try:
        from pymongo import MongoClient
        c = MongoClient("mongodb://localhost:27017/", serverSelectionTimeoutMS=3000)
        c.admin.command("ping")
        return c
    except ImportError:
        raise HTTPException(503, "pymongo is not installed in the HostPanel environment")
    except Exception as e:
        raise HTTPException(503, f"Cannot connect to MongoDB: {e}")


@router.get("/status")
async def get_status(_: User = Depends(require_admin)):
    try:
        from pymongo import MongoClient
        c = MongoClient("mongodb://localhost:27017/", serverSelectionTimeoutMS=2000)
        info = c.server_info()
        c.close()
        return {"running": True, "version": info.get("version")}
    except Exception:
        return {"running": False, "version": None}


@router.get("/count")
async def db_count(_: User = Depends(require_admin)):
    try:
        from pymongo import MongoClient
        c = MongoClient("mongodb://localhost:27017/", serverSelectionTimeoutMS=2000)
        count = len([d for d in c.list_database_names() if d not in SYSTEM_DBS])
        c.close()
        return {"count": count}
    except Exception:
        return {"count": 0}


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
            except Exception:
                size = 0
            result.append({"name": name, "size": size})
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
        db = c[name]
        db.create_collection("_init")
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
        try:
            c[name].command("dropAllUsersFromDatabase")
        except Exception:
            pass
        c.drop_database(name)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, str(e))
    finally:
        c.close()


@router.get("/databases/{db_name}/users")
async def list_users(db_name: str, _: User = Depends(require_admin)):
    c = _client()
    try:
        result = c[db_name].command("usersInfo")
        users = []
        for u in result.get("users", []):
            roles = []
            for r in u.get("roles", []):
                if isinstance(r, dict):
                    roles.append(r.get("role", str(r)))
                else:
                    roles.append(str(r))
            users.append({"username": u["user"], "roles": roles})
        return users
    except Exception as e:
        raise HTTPException(500, str(e))
    finally:
        c.close()


class CreateUserRequest(BaseModel):
    username: str
    password: str
    role: str = "readWrite"


@router.post("/databases/{db_name}/users")
async def create_user(db_name: str, body: CreateUserRequest, _: User = Depends(require_admin)):
    if not body.username.strip():
        raise HTTPException(400, "Username is required.")
    if not body.password:
        raise HTTPException(400, "Password is required.")
    allowed_roles = {"read", "readWrite", "dbAdmin", "dbOwner"}
    if body.role not in allowed_roles:
        raise HTTPException(400, f"Role must be one of: {', '.join(sorted(allowed_roles))}")
    c = _client()
    try:
        c[db_name].command(
            "createUser",
            body.username.strip(),
            pwd=body.password,
            roles=[{"role": body.role, "db": db_name}],
        )
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, str(e))
    finally:
        c.close()


class ChangePasswordRequest(BaseModel):
    password: str


@router.put("/databases/{db_name}/users/{username}/password")
async def change_password(
    db_name: str, username: str, body: ChangePasswordRequest, _: User = Depends(require_admin)
):
    if not body.password:
        raise HTTPException(400, "Password is required.")
    c = _client()
    try:
        c[db_name].command("updateUser", username, pwd=body.password)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, str(e))
    finally:
        c.close()


@router.delete("/databases/{db_name}/users/{username}")
async def delete_user(db_name: str, username: str, _: User = Depends(require_admin)):
    c = _client()
    try:
        c[db_name].command("dropUser", username)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, str(e))
    finally:
        c.close()
