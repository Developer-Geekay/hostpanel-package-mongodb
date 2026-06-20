/* hostpanel-package-mongodb — frontend/main.js */
(function () {
  'use strict';

  const sdk = window.__hpkg_sdk;
  const { html, useState, useEffect, useCallback, useRef } = sdk;
  const { SdkDataTable, SdkConfirmModal } = sdk.components;
  const { useApi, useToast } = sdk.hooks;

  // ── Helpers ───────────────────────────────────────────────────────────────

  function fmtSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return Math.round(bytes / 1024) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString();
  }

  function CopyButton({ text }) {
    const [copied, setCopied] = useState(false);
    function copy() {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      });
    }
    return html`
      <button class="btn btn-ghost btn-sm" onClick=${copy} style=${{ minWidth: 64 }}>
        ${copied ? 'Copied!' : 'Copy'}
      </button>
    `;
  }

  // ── Tab bar ───────────────────────────────────────────────────────────────

  function Tabs({ tabs, active, onChange }) {
    return html`
      <div style=${{
        display: 'flex', gap: 0, borderBottom: '1px solid var(--border)',
        marginBottom: 20,
      }}>
        ${tabs.map(t => html`
          <button
            key=${t.id}
            onClick=${() => onChange(t.id)}
            style=${{
              padding: '8px 20px', background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: 500,
              color: active === t.id ? 'var(--primary)' : 'var(--text-3)',
              borderBottom: active === t.id ? '2px solid var(--primary)' : '2px solid transparent',
              marginBottom: -1,
            }}
          >${t.label}</button>
        `)}
      </div>
    `;
  }

  // ── Status bar ────────────────────────────────────────────────────────────

  function StatusBar() {
    const { data, loading, refetch } = useApi(
      () => sdk.fetch('GET', '/cpanelapi/mongodb/status'),
    );
    useEffect(() => {
      const id = setInterval(refetch, 30000);
      return () => clearInterval(id);
    }, [refetch]);

    if (loading && !data) return html`
      <div style=${{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0', color: 'var(--text-3)', fontSize: 13 }}>
        <span class="dot dot-dim"></span> Checking MongoDB…
      </div>`;

    const running = data?.running;
    return html`
      <div style=${{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', flexWrap: 'wrap' }}>
        <span class=${running ? 'dot dot-ok' : 'dot dot-dim'}></span>
        <span style=${{ fontSize: 13, fontWeight: 500, color: running ? 'var(--ok)' : 'var(--text-3)' }}>
          ${running ? `MongoDB ${data?.version ?? ''}` : 'MongoDB offline'}
        </span>
        ${data?.port && html`
          <span style=${{ fontSize: 12, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
            port ${data.port}
          </span>
        `}
        ${!running && html`
          <span style=${{ fontSize: 12, color: 'var(--text-3)' }}>
            — Service not reachable. Check the Services page.
          </span>
        `}
      </div>
    `;
  }

  // ── Databases tab ─────────────────────────────────────────────────────────

  function CreateDatabaseModal({ onClose, onCreated }) {
    const { ok, err } = useToast();
    const [name, setName] = useState('');
    const [saving, setSaving] = useState(false);
    const [formError, setFormError] = useState('');

    async function handleCreate() {
      const trimmed = name.trim();
      if (!trimmed) { setFormError('Database name is required.'); return; }
      setSaving(true); setFormError('');
      try {
        await sdk.fetch('POST', '/cpanelapi/mongodb/databases', { name: trimmed });
        ok(`Database "${trimmed}" created.`);
        onCreated(); onClose();
      } catch (e) {
        const msg = e?.detail || e?.message || 'Failed to create database.';
        setFormError(msg); err(msg);
      } finally { setSaving(false); }
    }

    return html`
      <div class="modal-overlay" onClick=${e => e.target === e.currentTarget && onClose()}>
        <div class="modal animate-fade-in" style=${{ width: 420 }}>
          <div class="modal-header">
            <span class="modal-title">Create Database</span>
            <button class="modal-close" onClick=${onClose}>×</button>
          </div>
          <div class="modal-body" style=${{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div class="field">
              <label>DATABASE NAME</label>
              <input type="text" placeholder="my_database" value=${name} autoFocus
                onInput=${e => { setName(e.target.value); setFormError(''); }}
                onKeyDown=${e => e.key === 'Enter' && handleCreate()} />
            </div>
            <div style=${{ color: 'var(--text-3)', fontSize: 12 }}>
              Letters, numbers, underscores, hyphens. Max 38 characters.
            </div>
            ${formError && html`<div style=${{ color: 'var(--err)', fontSize: 12 }}>${formError}</div>`}
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost btn-sm" onClick=${onClose} disabled=${saving}>Cancel</button>
            <button class="btn btn-primary btn-sm" onClick=${handleCreate} disabled=${saving}>
              ${saving ? 'Creating…' : 'Create'}
            </button>
          </div>
        </div>
      </div>`;
  }

  function DatabasesTab() {
    const { ok, err } = useToast();
    const { data: databases, loading, error, refetch } = useApi(
      () => sdk.fetch('GET', '/cpanelapi/mongodb/databases'),
    );

    const [showCreate, setShowCreate] = useState(false);
    const [dropTarget, setDropTarget] = useState(null);
    const [dropping, setDropping] = useState(false);
    const [clearTarget, setClearTarget] = useState(null);
    const [clearing, setClearing] = useState(false);

    async function handleDrop() {
      if (!dropTarget) return;
      setDropping(true);
      try {
        await sdk.fetch('DELETE', `/cpanelapi/mongodb/databases/${dropTarget}`);
        ok(`Database "${dropTarget}" dropped. User permissions for it were revoked.`);
        setDropTarget(null); refetch();
      } catch (e) {
        err(e?.detail || e?.message || 'Failed to drop database.');
        setDropTarget(null);
      } finally { setDropping(false); }
    }

    async function handleClear() {
      if (!clearTarget) return;
      setClearing(true);
      try {
        await sdk.fetch('POST', `/cpanelapi/mongodb/databases/${clearTarget}/clear`);
        ok(`Database "${clearTarget}" cleared.`);
        setClearTarget(null); refetch();
      } catch (e) {
        err(e?.detail || e?.message || 'Failed to clear database.');
        setClearTarget(null);
      } finally { setClearing(false); }
    }

    const cols = [
      { key: 'name', label: 'Name', type: 'mono' },
      { key: 'sizeDisplay', label: 'Size' },
      { key: 'collections', label: 'Collections' },
    ];
    const rows = (databases || []).map(db => ({
      ...db, sizeDisplay: fmtSize(db.size),
    }));

    return html`
      <div class="card">
        <div style=${{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <span class="card-title" style=${{ marginBottom: 0 }}>Databases</span>
          <button class="btn btn-primary btn-sm" onClick=${() => setShowCreate(true)}>
            Create Database
          </button>
        </div>

        ${error && html`
          <div class="empty">
            <div class="empty-title" style=${{ color: 'var(--err)' }}>Could not load databases</div>
            <div class="empty-desc">${error?.detail || String(error)}</div>
          </div>`}

        ${!error && html`
          <${SdkDataTable}
            columns=${cols} rows=${rows} loading=${loading}
            empty=${{ title: 'No databases', desc: 'Create a database to get started.' }}
            renderActions=${row => html`
              <button class="btn btn-ghost btn-sm" onClick=${() => setClearTarget(row.name)}>Clear</button>
              <button class="btn btn-danger btn-sm" onClick=${() => setDropTarget(row.name)}>Drop</button>
            `}
          />`}
      </div>

      ${showCreate && html`
        <${CreateDatabaseModal} onClose=${() => setShowCreate(false)} onCreated=${refetch} />`}

      ${clearTarget && html`
        <${SdkConfirmModal}
          open=${true} title="Clear Database"
          message=${`Remove all collections inside "${clearTarget}"? The database itself is kept and permissions are unchanged.`}
          danger=${true}
          onClose=${() => setClearTarget(null)}
          onConfirm=${handleClear}
        />`}

      ${dropTarget && html`
        <${SdkConfirmModal}
          open=${true} title="Drop Database"
          message=${`Drop "${dropTarget}"? All data will be permanently deleted. Users with permissions on this database will have those permissions revoked but will not be deleted.`}
          danger=${true}
          onClose=${() => setDropTarget(null)}
          onConfirm=${handleDrop}
        />`}
    `;
  }

  // ── Users tab ─────────────────────────────────────────────────────────────

  function RoleChips({ roles, authDb, username, onChanged }) {
    const { ok, err } = useToast();
    if (!roles || roles.length === 0) {
      return html`<span style=${{ color: 'var(--text-3)', fontSize: 12 }}>No roles</span>`;
    }
    return html`
      <div style=${{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        ${roles.map((r, i) => html`
          <span key=${i} style=${{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            background: 'var(--bg-3)', borderRadius: 4, padding: '2px 8px',
            fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-2)',
          }}>
            ${r.db}:${r.role}
            <button
              title="Revoke this role"
              onClick=${async () => {
                try {
                  await sdk.fetch('DELETE', `/cpanelapi/mongodb/users/${authDb}/${username}/roles/${r.db}/${r.role}`);
                  ok(`Revoked ${r.role} on ${r.db} from ${username}.`);
                  onChanged();
                } catch (e) { err(e?.detail || 'Failed to revoke role.'); }
              }}
              style=${{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--err)', padding: 0, lineHeight: 1, fontSize: 13,
              }}
            >×</button>
          </span>
        `)}
      </div>`;
  }

  function GrantRoleModal({ authDb, username, databases, onClose, onGranted }) {
    const { ok, err } = useToast();
    const [db, setDb] = useState(databases?.[0]?.name || '');
    const [customDb, setCustomDb] = useState('');
    const [role, setRole] = useState('readWrite');
    const [saving, setSaving] = useState(false);
    const [formError, setFormError] = useState('');

    const targetDb = db === '__custom__' ? customDb.trim() : db;

    async function handleGrant() {
      if (!targetDb) { setFormError('Database is required.'); return; }
      setSaving(true); setFormError('');
      try {
        await sdk.fetch('POST', `/cpanelapi/mongodb/users/${authDb}/${username}/roles`, { db: targetDb, role });
        ok(`Granted ${role} on ${targetDb} to ${username}.`);
        onGranted(); onClose();
      } catch (e) {
        const msg = e?.detail || 'Failed to grant role.';
        setFormError(msg); err(msg);
      } finally { setSaving(false); }
    }

    return html`
      <div class="modal-overlay" onClick=${e => e.target === e.currentTarget && onClose()}>
        <div class="modal animate-fade-in" style=${{ width: 420 }}>
          <div class="modal-header">
            <span class="modal-title">Grant Role — ${username}</span>
            <button class="modal-close" onClick=${onClose}>×</button>
          </div>
          <div class="modal-body" style=${{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div class="field">
              <label>DATABASE</label>
              <select value=${db} onChange=${e => { setDb(e.target.value); setFormError(''); }}>
                ${(databases || []).map(d => html`<option value=${d.name}>${d.name}</option>`)}
                <option value="__custom__">Other (type below)</option>
              </select>
            </div>
            ${db === '__custom__' && html`
              <div class="field">
                <label>DATABASE NAME</label>
                <input type="text" placeholder="database name"
                  value=${customDb} onInput=${e => setCustomDb(e.target.value)} />
              </div>`}
            <div class="field">
              <label>ROLE</label>
              <select value=${role} onChange=${e => setRole(e.target.value)}>
                <option value="readWrite">readWrite</option>
                <option value="read">read</option>
                <option value="dbAdmin">dbAdmin</option>
                <option value="dbOwner">dbOwner</option>
              </select>
            </div>
            ${formError && html`<div style=${{ color: 'var(--err)', fontSize: 12 }}>${formError}</div>`}
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost btn-sm" onClick=${onClose} disabled=${saving}>Cancel</button>
            <button class="btn btn-primary btn-sm" onClick=${handleGrant} disabled=${saving}>
              ${saving ? 'Granting…' : 'Grant'}
            </button>
          </div>
        </div>
      </div>`;
  }

  function ChangePasswordModal({ authDb, username, onClose }) {
    const { ok, err } = useToast();
    const [password, setPassword] = useState('');
    const [saving, setSaving] = useState(false);
    const [formError, setFormError] = useState('');

    async function handleSave() {
      if (!password) { setFormError('Password is required.'); return; }
      setSaving(true); setFormError('');
      try {
        await sdk.fetch('PUT', `/cpanelapi/mongodb/users/${authDb}/${username}/password`, { password });
        ok('Password updated.');
        onClose();
      } catch (e) {
        const msg = e?.detail || 'Failed to update password.';
        setFormError(msg); err(msg);
      } finally { setSaving(false); }
    }

    return html`
      <div class="modal-overlay" onClick=${e => e.target === e.currentTarget && onClose()}>
        <div class="modal animate-fade-in" style=${{ width: 420 }}>
          <div class="modal-header">
            <span class="modal-title">Change Password — ${username}</span>
            <button class="modal-close" onClick=${onClose}>×</button>
          </div>
          <div class="modal-body" style=${{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div class="field">
              <label>NEW PASSWORD</label>
              <input type="password" autocomplete="new-password" placeholder="New password"
                value=${password}
                onInput=${e => { setPassword(e.target.value); setFormError(''); }}
                onKeyDown=${e => e.key === 'Enter' && handleSave()} autoFocus />
            </div>
            ${formError && html`<div style=${{ color: 'var(--err)', fontSize: 12 }}>${formError}</div>`}
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost btn-sm" onClick=${onClose} disabled=${saving}>Cancel</button>
            <button class="btn btn-primary btn-sm" onClick=${handleSave} disabled=${saving}>
              ${saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>`;
  }

  function CreateUserModal({ databases, onClose, onCreated }) {
    const { ok, err } = useToast();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [authDb, setAuthDb] = useState(databases?.[0]?.name || '');
    const [customDb, setCustomDb] = useState('');
    const [role, setRole] = useState('readWrite');
    const [saving, setSaving] = useState(false);
    const [formError, setFormError] = useState('');

    const targetDb = authDb === '__custom__' ? customDb.trim() : authDb;

    async function handleCreate() {
      if (!username.trim()) { setFormError('Username is required.'); return; }
      if (!password) { setFormError('Password is required.'); return; }
      if (!targetDb) { setFormError('Authentication database is required.'); return; }
      setSaving(true); setFormError('');
      try {
        await sdk.fetch('POST', '/cpanelapi/mongodb/users', {
          username: username.trim(), password, auth_db: targetDb, role,
        });
        ok(`User "${username.trim()}" created.`);
        onCreated(); onClose();
      } catch (e) {
        const msg = e?.detail || 'Failed to create user.';
        setFormError(msg); err(msg);
      } finally { setSaving(false); }
    }

    return html`
      <div class="modal-overlay" onClick=${e => e.target === e.currentTarget && onClose()}>
        <div class="modal animate-fade-in" style=${{ width: 480 }}>
          <div class="modal-header">
            <span class="modal-title">Create User</span>
            <button class="modal-close" onClick=${onClose}>×</button>
          </div>
          <div class="modal-body" style=${{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div class="field">
                <label>USERNAME</label>
                <input type="text" placeholder="username" value=${username} autoFocus
                  onInput=${e => { setUsername(e.target.value); setFormError(''); }} />
              </div>
              <div class="field">
                <label>PASSWORD</label>
                <input type="password" autocomplete="new-password" placeholder="Password"
                  value=${password} onInput=${e => { setPassword(e.target.value); setFormError(''); }} />
              </div>
            </div>
            <div class="field">
              <label>AUTHENTICATION DATABASE</label>
              <select value=${authDb} onChange=${e => { setAuthDb(e.target.value); setFormError(''); }}>
                ${(databases || []).map(d => html`<option value=${d.name}>${d.name}</option>`)}
                <option value="__custom__">Other (type below)</option>
              </select>
            </div>
            ${authDb === '__custom__' && html`
              <div class="field">
                <label>DATABASE NAME</label>
                <input type="text" placeholder="database name"
                  value=${customDb} onInput=${e => setCustomDb(e.target.value)} />
              </div>`}
            <div class="field">
              <label>INITIAL ROLE</label>
              <select value=${role} onChange=${e => setRole(e.target.value)}>
                <option value="readWrite">readWrite</option>
                <option value="read">read</option>
                <option value="dbAdmin">dbAdmin</option>
                <option value="dbOwner">dbOwner</option>
              </select>
            </div>
            <div style=${{ color: 'var(--text-3)', fontSize: 12 }}>
              The authentication database is the database this user authenticates against.
              You can grant additional database permissions after creation.
            </div>
            ${formError && html`<div style=${{ color: 'var(--err)', fontSize: 12 }}>${formError}</div>`}
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost btn-sm" onClick=${onClose} disabled=${saving}>Cancel</button>
            <button class="btn btn-primary btn-sm" onClick=${handleCreate} disabled=${saving}>
              ${saving ? 'Creating…' : 'Create User'}
            </button>
          </div>
        </div>
      </div>`;
  }

  function ConnectionStringPanel({ user, port }) {
    const [showPwd, setShowPwd] = useState(false);
    if (!user) return null;

    const host = '127.0.0.1';
    const connStr = `mongodb://${user.username}:<password>@${host}:${port}/${user.auth_db}`;
    const externalNote = `For external access, replace 127.0.0.1 with your server's public IP or hostname, and ensure port ${port} is accessible.`;

    return html`
      <div style=${{
        marginTop: 24, borderTop: '1px solid var(--border)', paddingTop: 20,
      }}>
        <div class="card-title" style=${{ marginBottom: 12 }}>Connection String — ${user.username}</div>
        <div style=${{
          background: 'var(--bg-3)', borderRadius: 6, padding: '10px 14px',
          fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-1)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          wordBreak: 'break-all',
        }}>
          <span>${connStr}</span>
          <${CopyButton} text=${connStr} />
        </div>
        <div style=${{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style=${{ fontSize: 12, color: 'var(--text-3)' }}>
            Replace <code style=${{ background: 'var(--bg-3)', padding: '1px 4px', borderRadius: 3 }}>&lt;password&gt;</code> with the user's actual password.
          </div>
          <div style=${{ fontSize: 12, color: 'var(--text-3)' }}>${externalNote}</div>
          <div style=${{ marginTop: 4 }}>
            <div style=${{ fontSize: 12, fontWeight: 500, color: 'var(--text-2)', marginBottom: 6 }}>Quick reference</div>
            <div style=${{
              background: 'var(--bg-3)', borderRadius: 6, padding: '10px 14px',
              fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-3)',
              display: 'flex', flexDirection: 'column', gap: 4,
            }}>
              <div><span style=${{ color: 'var(--text-2)' }}># mongosh</span></div>
              <div style=${{ color: 'var(--text-1)' }}>mongosh "${connStr}"</div>
              <div style=${{ marginTop: 6, color: 'var(--text-2)' }}># Node.js (mongoose)</div>
              <div style=${{ color: 'var(--text-1)' }}>mongoose.connect('${connStr}')</div>
              <div style=${{ marginTop: 6, color: 'var(--text-2)' }}># Python (pymongo)</div>
              <div style=${{ color: 'var(--text-1)' }}>MongoClient('${connStr}')</div>
            </div>
          </div>
        </div>
      </div>`;
  }

  function UsersTab({ statusData }) {
    const { ok, err } = useToast();
    const port = statusData?.port || 27017;

    const { data: users, loading, error, refetch } = useApi(
      () => sdk.fetch('GET', '/cpanelapi/mongodb/users'),
    );
    const { data: databases } = useApi(
      () => sdk.fetch('GET', '/cpanelapi/mongodb/databases'),
    );

    const [showCreate, setShowCreate] = useState(false);
    const [grantTarget, setGrantTarget] = useState(null);
    const [pwdTarget, setPwdTarget] = useState(null);
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [deleting, setDeleting] = useState(false);
    const [connUser, setConnUser] = useState(null);

    async function handleDelete() {
      if (!deleteTarget) return;
      setDeleting(true);
      try {
        await sdk.fetch('DELETE', `/cpanelapi/mongodb/users/${deleteTarget.auth_db}/${deleteTarget.username}`);
        ok(`User "${deleteTarget.username}" deleted.`);
        setDeleteTarget(null);
        if (connUser?.username === deleteTarget.username) setConnUser(null);
        refetch();
      } catch (e) {
        err(e?.detail || 'Failed to delete user.');
        setDeleteTarget(null);
      } finally { setDeleting(false); }
    }

    const cols = [
      { key: 'username', label: 'Username', type: 'mono' },
      { key: 'auth_db', label: 'Auth DB', type: 'mono' },
      { key: 'rolesDisplay', label: 'Roles' },
    ];

    const rows = (users || []).map(u => ({
      ...u,
      rolesDisplay: html`
        <${RoleChips}
          roles=${u.roles} authDb=${u.auth_db} username=${u.username}
          onChanged=${refetch}
        />`,
    }));

    return html`
      <div class="card">
        <div style=${{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <span class="card-title" style=${{ marginBottom: 0 }}>Users</span>
          <button class="btn btn-primary btn-sm" onClick=${() => setShowCreate(true)}>
            Create User
          </button>
        </div>

        ${error && html`
          <div class="empty">
            <div class="empty-title" style=${{ color: 'var(--err)' }}>Could not load users</div>
            <div class="empty-desc">${error?.detail || String(error)}</div>
          </div>`}

        ${!error && html`
          <${SdkDataTable}
            columns=${cols} rows=${rows} loading=${loading}
            empty=${{ title: 'No users', desc: 'Create a user to get started.' }}
            renderActions=${row => html`
              <button class="btn btn-ghost btn-sm"
                onClick=${() => setConnUser(connUser?.username === row.username ? null : row)}>
                ${connUser?.username === row.username ? 'Hide Connect' : 'Connect'}
              </button>
              <button class="btn btn-ghost btn-sm" onClick=${() => setGrantTarget(row)}>
                Grant Role
              </button>
              <button class="btn btn-ghost btn-sm" onClick=${() => setPwdTarget(row)}>
                Change Password
              </button>
              <button class="btn btn-danger btn-sm" onClick=${() => setDeleteTarget(row)}>
                Delete
              </button>
            `}
          />`}

        <${ConnectionStringPanel} user=${connUser} port=${port} />
      </div>

      ${showCreate && html`
        <${CreateUserModal}
          databases=${databases || []}
          onClose=${() => setShowCreate(false)}
          onCreated=${refetch}
        />`}

      ${grantTarget && html`
        <${GrantRoleModal}
          authDb=${grantTarget.auth_db}
          username=${grantTarget.username}
          databases=${databases || []}
          onClose=${() => setGrantTarget(null)}
          onGranted=${refetch}
        />`}

      ${pwdTarget && html`
        <${ChangePasswordModal}
          authDb=${pwdTarget.auth_db}
          username=${pwdTarget.username}
          onClose=${() => setPwdTarget(null)}
        />`}

      ${deleteTarget && html`
        <${SdkConfirmModal}
          open=${true} title="Delete User"
          message=${`Delete user "${deleteTarget.username}"? This cannot be undone.`}
          danger=${true}
          onClose=${() => setDeleteTarget(null)}
          onConfirm=${handleDelete}
        />`}
    `;
  }

  // ── Backups tab ───────────────────────────────────────────────────────────

  function BackupsTab({ databases }) {
    const { ok, err } = useToast();
    const { data, loading, error, refetch } = useApi(
      () => sdk.fetch('GET', '/cpanelapi/mongodb/backups'),
    );

    const [backing, setBacking] = useState(false);
    const [restoreTarget, setRestoreTarget] = useState(null);
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [backupDb, setBackupDb] = useState('__all__');
    const [dropOnRestore, setDropOnRestore] = useState(false);

    const toolAvailable = data?.tool_available;
    const backups = data?.backups || [];

    async function handleBackup() {
      setBacking(true);
      try {
        const db = backupDb === '__all__' ? undefined : backupDb;
        const res = await sdk.fetch('POST', '/cpanelapi/mongodb/backups', { db: db || null });
        ok(`Backup "${res.name}" created.`);
        refetch();
      } catch (e) {
        err(e?.detail || 'Backup failed.');
      } finally { setBacking(false); }
    }

    async function handleRestore() {
      if (!restoreTarget) return;
      try {
        await sdk.fetch('POST', '/cpanelapi/mongodb/backups/restore', { name: restoreTarget, drop: dropOnRestore });
        ok(`Restored from "${restoreTarget}".`);
        setRestoreTarget(null);
      } catch (e) {
        err(e?.detail || 'Restore failed.');
        setRestoreTarget(null);
      }
    }

    async function handleDeleteBackup() {
      if (!deleteTarget) return;
      try {
        await sdk.fetch('DELETE', `/cpanelapi/mongodb/backups/${deleteTarget}`);
        ok(`Backup "${deleteTarget}" deleted.`);
        setDeleteTarget(null); refetch();
      } catch (e) {
        err(e?.detail || 'Failed to delete backup.');
        setDeleteTarget(null);
      }
    }

    if (!loading && !toolAvailable) {
      return html`
        <div class="card">
          <div class="card-title">Backups</div>
          <div class="empty">
            <div class="empty-title">mongodump not available</div>
            <div class="empty-desc">
              Place the <code>mongodump</code> and <code>mongorestore</code> binaries (aarch64)
              alongside <code>mongod</code> in <code>/opt/hostpanel/plugins/mongodb/</code>.
              They can be downloaded from the MongoDB Database Tools package for Ubuntu 24.04 ARM64.
            </div>
          </div>
        </div>`;
    }

    const cols = [
      { key: 'name', label: 'Name', type: 'mono' },
      { key: 'scope', label: 'Scope' },
      { key: 'dateDisplay', label: 'Created' },
    ];
    const rows = backups.map(b => ({
      ...b,
      scope: b.db || 'Full backup',
      dateDisplay: fmtDate(b.created_at),
    }));

    return html`
      <div class="card">
        <div style=${{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <span class="card-title" style=${{ marginBottom: 0 }}>Backups</span>
          <div style=${{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select
              value=${backupDb}
              onChange=${e => setBackupDb(e.target.value)}
              style=${{ fontSize: 13, padding: '4px 8px' }}>
              <option value="__all__">All databases</option>
              ${(databases || []).map(d => html`<option value=${d.name}>${d.name}</option>`)}
            </select>
            <button class="btn btn-primary btn-sm" onClick=${handleBackup} disabled=${backing}>
              ${backing ? 'Backing up…' : 'Backup Now'}
            </button>
          </div>
        </div>

        <${SdkDataTable}
          columns=${cols} rows=${rows} loading=${loading}
          empty=${{ title: 'No backups', desc: 'Create your first backup.' }}
          renderActions=${row => html`
            <button class="btn btn-ghost btn-sm" onClick=${() => setRestoreTarget(row.name)}>Restore</button>
            <button class="btn btn-danger btn-sm" onClick=${() => setDeleteTarget(row.name)}>Delete</button>
          `}
        />
      </div>

      ${restoreTarget && html`
        <div class="modal-overlay" onClick=${e => e.target === e.currentTarget && setRestoreTarget(null)}>
          <div class="modal animate-fade-in" style=${{ width: 440 }}>
            <div class="modal-header">
              <span class="modal-title">Restore Backup</span>
              <button class="modal-close" onClick=${() => setRestoreTarget(null)}>×</button>
            </div>
            <div class="modal-body" style=${{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style=${{ fontSize: 13 }}>Restore from <strong>${restoreTarget}</strong>?</div>
              <label style=${{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked=${dropOnRestore}
                  onChange=${e => setDropOnRestore(e.target.checked)} />
                Drop existing collections before restoring
              </label>
              <div style=${{ color: 'var(--text-3)', fontSize: 12 }}>
                Without "drop", restored data is merged with existing data.
              </div>
            </div>
            <div class="modal-footer">
              <button class="btn btn-ghost btn-sm" onClick=${() => setRestoreTarget(null)}>Cancel</button>
              <button class="btn btn-danger btn-sm" onClick=${handleRestore}>Restore</button>
            </div>
          </div>
        </div>`}

      ${deleteTarget && html`
        <${SdkConfirmModal}
          open=${true} title="Delete Backup"
          message=${`Permanently delete backup "${deleteTarget}"?`}
          danger=${true}
          onClose=${() => setDeleteTarget(null)}
          onConfirm=${handleDeleteBackup}
        />`}
    `;
  }

  // ── Main Plugin ───────────────────────────────────────────────────────────

  const TABS = [
    { id: 'databases', label: 'Databases' },
    { id: 'users',     label: 'Users' },
    { id: 'backups',   label: 'Backups' },
  ];

  function MongoDBPlugin() {
    const [tab, setTab] = useState('databases');
    const { data: statusData } = useApi(() => sdk.fetch('GET', '/cpanelapi/mongodb/status'));
    const { data: databases } = useApi(() => sdk.fetch('GET', '/cpanelapi/mongodb/databases'));

    return html`
      <div class="page">
        <div class="page-header">
          <div>
            <h1 class="page-title">MongoDB</h1>
            <p class="page-desc">Manage databases, users, and backups.</p>
          </div>
        </div>

        <${StatusBar} />
        <${Tabs} tabs=${TABS} active=${tab} onChange=${setTab} />

        ${tab === 'databases' && html`<${DatabasesTab} />`}
        ${tab === 'users'     && html`<${UsersTab} statusData=${statusData} />`}
        ${tab === 'backups'   && html`<${BackupsTab} databases=${databases} />`}
      </div>
    `;
  }

  sdk.register('mongodb', MongoDBPlugin);
})();
