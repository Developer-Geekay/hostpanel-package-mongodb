import logging
import os
import pwd
import subprocess

from fastapi import HTTPException

logger = logging.getLogger(__name__)

MONGO_DIR    = "/opt/hostpanel/plugins/mongodb"
MONGOD_BIN   = f"{MONGO_DIR}/mongod"
DATA_DIR     = f"{MONGO_DIR}/data"
LOG_DIR      = f"{MONGO_DIR}/logs"
CONF_FILE    = f"{MONGO_DIR}/mongod.conf"
SERVICE_NAME = "hostpanel-mongodb"
SERVICE_DST  = f"/etc/systemd/system/{SERVICE_NAME}.service"
SUDOERS_DST  = "/etc/sudoers.d/hostpanel-mongodb"

BINARIES_REPO         = "https://github.com/Developer-Geekay/hostpanel-binaries"
MONGODB_BIN_VERSION   = "8.0.4"
MONGODB_TOOLS_VERSION = "100.10.0"
PRIMARY_ARCH          = "aarch64"
TOOLS = ("mongodump", "mongorestore")


def _run(cmd, timeout=60):
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)


def _get_service_user():
    try:
        return pwd.getpwuid(os.getuid()).pw_name
    except Exception:
        return "root"


def _mongod_ready():
    return os.path.isfile(MONGOD_BIN) and os.access(MONGOD_BIN, os.X_OK)


def _service_active():
    return _run(["sudo", "-n", "systemctl", "is-active", SERVICE_NAME]).returncode == 0


def _tools_ready():
    return all(
        os.path.isfile(f"{MONGO_DIR}/{t}") and os.access(f"{MONGO_DIR}/{t}", os.X_OK)
        for t in TOOLS
    )


def _download_tools():
    for tool in TOOLS:
        url = f"{BINARIES_REPO}/releases/download/mongodb-tools-{MONGODB_TOOLS_VERSION}/{tool}-{PRIMARY_ARCH}"
        dst = f"{MONGO_DIR}/{tool}"
        logger.info("Downloading %s %s (%s)", tool, MONGODB_TOOLS_VERSION, PRIMARY_ARCH)
        r = subprocess.run(
            ["curl", "-fsSL", "-o", dst, url],
            capture_output=True, text=True, timeout=300,
        )
        if r.returncode != 0:
            if os.path.exists(dst):
                os.remove(dst)
            logger.warning("Failed to download %s: %s", tool, r.stderr.strip() or r.stdout.strip())
            return
        os.chmod(dst, 0o755)
        logger.info("%s downloaded to %s", tool, dst)


def _download_mongod():
    url = f"{BINARIES_REPO}/releases/download/mongodb-{MONGODB_BIN_VERSION}/mongod-{PRIMARY_ARCH}"
    logger.info("Downloading mongod %s (%s)", MONGODB_BIN_VERSION, PRIMARY_ARCH)
    r = subprocess.run(
        ["curl", "-fsSL", "-o", MONGOD_BIN, url],
        capture_output=True, text=True, timeout=600,
    )
    if r.returncode != 0:
        if os.path.exists(MONGOD_BIN):
            os.remove(MONGOD_BIN)
        raise RuntimeError(f"Failed to download mongod binary: {r.stderr.strip() or r.stdout.strip()}")
    os.chmod(MONGOD_BIN, 0o755)
    logger.info("mongod downloaded to %s", MONGOD_BIN)


def _write_config():
    # The security posture lives in the core DB (mongodb_settings) so package
    # updates re-apply it instead of resetting an exposed server to open.
    try:
        from hostpanel_mongodb import settings
        bind_ip = settings.bind_ip()
        auth = settings.auth_enabled()
    except Exception as exc:
        logger.warning("Could not read mongodb settings, using safe defaults: %s", exc)
        bind_ip, auth = "127.0.0.1", False
    if bind_ip != "127.0.0.1" and not auth:
        # Never materialize a config that is both exposed and unauthenticated.
        logger.warning("Refusing wide bindIp without auth enforcement; falling back to loopback")
        bind_ip = "127.0.0.1"
    security_block = "\nsecurity:\n  authorization: enabled\n" if auth else ""
    config = f"""\
storage:
  dbPath: {DATA_DIR}

systemLog:
  destination: file
  path: {LOG_DIR}/mongod.log
  logAppend: true

net:
  port: 27017
  bindIp: {bind_ip}
{security_block}
processManagement:
  timeZoneInfo: /usr/share/zoneinfo
"""
    try:
        with open(CONF_FILE, "w") as f:
            f.write(config)
    except PermissionError:
        r = subprocess.run(["sudo", "-n", "tee", CONF_FILE],
                           input=config, text=True, capture_output=True)
        if r.returncode != 0:
            raise RuntimeError(f"Could not write mongod.conf: {r.stderr.strip()}")


def _install_service():
    service_user = _get_service_user()
    content = f"""\
[Unit]
Description=HostPanel MongoDB
After=network.target

[Service]
Type=simple
User={service_user}
ExecStart={MONGOD_BIN} --config {CONF_FILE}
Restart=on-failure
RestartSec=5
LimitNOFILE=64000

[Install]
WantedBy=multi-user.target
"""
    r = subprocess.run(["sudo", "-n", "tee", SERVICE_DST],
                       input=content, text=True, capture_output=True)
    if r.returncode == 0:
        subprocess.run(["sudo", "-n", "chmod", "644", SERVICE_DST], capture_output=True)
        logger.info("Installed %s (User=%s)", SERVICE_DST, service_user)
    else:
        logger.warning("Could not install service file: %s", r.stderr.strip())


def on_install():
    logger.info("MongoDB on_install: starting")

    for d in (MONGO_DIR, DATA_DIR, LOG_DIR):
        os.makedirs(d, exist_ok=True)

    if not _mongod_ready():
        _download_mongod()

    if not _tools_ready():
        _download_tools()

    _write_config()
    _install_service()

    _run(["sudo", "-n", "systemctl", "daemon-reload"])
    _run(["sudo", "-n", "systemctl", "enable", SERVICE_NAME])
    r = _run(["sudo", "-n", "systemctl", "start", SERVICE_NAME])
    if r.returncode != 0:
        logger.warning("Could not start %s: %s", SERVICE_NAME, r.stderr.strip())

    logger.info("MongoDB on_install: complete")


def on_startup():
    if not _mongod_ready():
        logger.warning("MongoDB on_startup: mongod binary missing, skipping")
        return
    if not _service_active():
        logger.info("MongoDB on_startup: service not active, starting")
        _run(["sudo", "-n", "systemctl", "start", SERVICE_NAME])
    else:
        logger.info("MongoDB on_startup: service active")


def pre_uninstall(force: bool = False):
    if not force:
        raise HTTPException(
            status_code=409,
            detail=(
                "Cannot uninstall MongoDB plugin while it is active. "
                "Use force=True to stop the service and remove plugin files. "
                "Data under /opt/hostpanel/plugins/mongodb/data is also removed on force."
            ),
        )
    _run(["sudo", "-n", "systemctl", "stop", SERVICE_NAME])
    _run(["sudo", "-n", "systemctl", "disable", SERVICE_NAME])
    _run(["sudo", "-n", "rm", "-f", SERVICE_DST])
    _run(["sudo", "-n", "systemctl", "daemon-reload"])
    if os.path.isdir(MONGO_DIR):
        _run(["sudo", "-n", "rm", "-rf", MONGO_DIR])
    _run(["sudo", "-n", "rm", "-f", SUDOERS_DST])
    logger.info("MongoDB pre_uninstall: complete")
