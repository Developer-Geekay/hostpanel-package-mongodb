/* hostpanel-package-mongodb — frontend/main.js */
(function () {
  'use strict';

  const sdk = window.__hpkg_sdk;
  const { html, useState, useEffect } = sdk;
  const { SdkConfirmModal } = sdk.components;
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

  // ── Base components ───────────────────────────────────────────────────────

  const BADGE_COLORS = {
    default: { bg: 'var(--bg-3)',             color: 'var(--text-3)' },
    blue:    { bg: 'rgba(59,130,246,0.12)',   color: '#60a5fa'       },
    green:   { bg: 'rgba(34,197,94,0.12)',    color: '#4ade80'       },
    orange:  { bg: 'rgba(249,115,22,0.12)',   color: '#fb923c'       },
    purple:  { bg: 'rgba(168,85,247,0.12)',   color: '#c084fc'       },
  };

  function Badge({ children, color = 'default' }) {
    const c = BADGE_COLORS[color] || BADGE_COLORS.default;
    return html`
      <span style=${{
        display: 'inline-flex', alignItems: 'center',
        background: c.bg, color: c.color,
        borderRadius: 4, padding: '2px 8px',
        fontSize: 11, fontWeight: 500, letterSpacing: '0.02em',
        fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap',
      }}>${children}</span>`;
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
      <button class="btn btn-ghost btn-sm" onClick=${copy} style=${{ minWidth: 70 }}>
        ${copied ? '✓ Copied' : 'Copy'}
      </button>`;
  }

  // Custom table — supports vdom in cells
  function Table({ columns, rows, loading, empty, renderActions }) {
    const thStyle = {
      padding: '8px 14px', textAlign: 'left',
      fontSize: 11, fontWeight: 600, color: 'var(--text-3)',
      letterSpacing: '0.06em', borderBottom: '1px solid var(--border)',
      background: 'var(--bg-2)',
    };
    const tdStyle = {
      padding: '11px 14px', borderBottom: '1px solid var(--border)',
      fontSize: 13, color: 'var(--text-1)', verticalAlign: 'middle',
    };

    if (loading) return html`
      <div style=${{ padding: '40px', textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
        Loading…
      </div>`;

    if (!rows || rows.length === 0) return html`
      <div style=${{ padding: '48px 20px', textAlign: 'center' }}>
        <div style=${{ fontSize: 15, fontWeight: 500, color: 'var(--text-2)', marginBottom: 6 }}>${empty?.title || 'No items'}</div>
        ${empty?.desc && html`<div style=${{ fontSize: 13, color: 'var(--text-3)' }}>${empty.desc}</div>`}
      </div>`;

    return html`
      <div style=${{ overflowX: 'auto', borderRadius: 8, border: '1px solid var(--border)' }}>
        <table style=${{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              ${columns.map(c => html`<th key=${c.key} style=${thStyle}>${c.label}</th>`)}
              ${renderActions && html`<th style=${{ ...thStyle, textAlign: 'right' }}></th>`}
            </tr>
          </thead>
          <tbody>
            ${rows.map((row, i) => html`
              <tr key=${i}
                onMouseEnter=${e => e.currentTarget.style.background = 'var(--bg-2)'}
                onMouseLeave=${e => e.currentTarget.style.background = ''}>
                ${columns.map(c => html`
                  <td key=${c.key} style=${{ ...tdStyle, ...(i === rows.length - 1 ? { borderBottom: 'none' } : {}) }}>
                    ${row[c.key]}
                  </td>`)}
                ${renderActions && html`
                  <td style=${{ ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap', ...(i === rows.length - 1 ? { borderBottom: 'none' } : {}) }}>
                    <div style=${{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      ${renderActions(row)}
                    </div>
                  </td>`}
              </tr>`)}
          </tbody>
        </table>
      </div>`;
  }

  // ── Tab bar ───────────────────────────────────────────────────────────────

  function Tabs({ tabs, active, onChange }) {
    return html`
      <div style=${{
        display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 24,
      }}>
        ${tabs.map(t => html`
          <button key=${t.id} onClick=${() => onChange(t.id)} style=${{
            padding: '9px 22px', background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 13, fontWeight: 500,
            color: active === t.id ? 'var(--primary)' : 'var(--text-3)',
            borderBottom: active === t.id ? '2px solid var(--primary)' : '2px solid transparent',
            marginBottom: -1, transition: 'color 0.15s',
          }}>${t.label}</button>`)}
      </div>`;
  }

  // ── Status bar ────────────────────────────────────────────────────────────

  function StatusBar() {
    const { data, loading, refetch } = useApi(() => sdk.fetch('GET', '/cpanelapi/mongodb/status'));
    useEffect(() => {
      const id = setInterval(refetch, 30000);
      return () => clearInterval(id);
    }, [refetch]);

    if (loading && !data) return html`
      <div style=${{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: '6px 14px', borderRadius: 20, marginBottom: 20,
        background: 'var(--bg-2)', border: '1px solid var(--border)',
        fontSize: 13, color: 'var(--text-3)',
      }}>
        <span class="dot dot-dim"></span> Checking…
      </div>`;

    const running = data?.running;
    return html`
      <div style=${{
        display: 'inline-flex', alignItems: 'center', gap: 0,
        borderRadius: 20, marginBottom: 20, overflow: 'hidden',
        border: running ? '1px solid rgba(34,197,94,0.3)' : '1px solid var(--border)',
      }}>
        <div style=${{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 14px',
          background: running ? 'rgba(34,197,94,0.08)' : 'var(--bg-2)',
        }}>
          <span class=${running ? 'dot dot-ok' : 'dot dot-dim'}></span>
          <span style=${{ fontSize: 13, fontWeight: 500, color: running ? 'var(--ok)' : 'var(--text-3)' }}>
            ${running ? `MongoDB ${data?.version ?? ''}` : 'MongoDB offline'}
          </span>
        </div>
        ${data?.port && html`
          <div style=${{
            padding: '6px 14px', fontSize: 12, fontFamily: 'var(--font-mono)',
            color: 'var(--text-3)', background: 'var(--bg-2)',
            borderLeft: running ? '1px solid rgba(34,197,94,0.2)' : '1px solid var(--border)',
          }}>:${data.port}</div>`}
        ${!running && html`
          <div style=${{
            padding: '6px 14px', fontSize: 12, color: 'var(--text-3)',
            borderLeft: '1px solid var(--border)', background: 'var(--bg-2)',
          }}>Check Services page</div>`}
      </div>`;
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
              Letters, numbers, underscores, hyphens — max 38 characters.
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
      if (!dropTarget) return; setDropping(true);
      try {
        await sdk.fetch('DELETE', `/cpanelapi/mongodb/databases/${dropTarget}`);
        ok(`"${dropTarget}" dropped. User permissions revoked.`);
        setDropTarget(null); refetch();
      } catch (e) { err(e?.detail || 'Failed to drop.'); setDropTarget(null); }
      finally { setDropping(false); }
    }

    async function handleClear() {
      if (!clearTarget) return; setClearing(true);
      try {
        await sdk.fetch('POST', `/cpanelapi/mongodb/databases/${clearTarget}/clear`);
        ok(`"${clearTarget}" cleared.`);
        setClearTarget(null); refetch();
      } catch (e) { err(e?.detail || 'Failed to clear.'); setClearTarget(null); }
      finally { setClearing(false); }
    }

    const cols = [
      { key: 'nameCell',        label: 'Name' },
      { key: 'sizeCell',        label: 'Size' },
      { key: 'collectionsCell', label: 'Collections' },
    ];

    const rows = (databases || []).map(db => ({
      ...db,
      nameCell:        html`<span style=${{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>${db.name}</span>`,
      sizeCell:        html`<${Badge}>${fmtSize(db.size)}</${Badge}>`,
      collectionsCell: html`<span style=${{ color: 'var(--text-2)' }}>${db.collections}</span>`,
    }));

    return html`
      <div class="card">
        <div style=${{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <div class="card-title" style=${{ marginBottom: 2 }}>Databases</div>
            ${!loading && databases?.length > 0 && html`
              <div style=${{ fontSize: 12, color: 'var(--text-3)' }}>
                ${databases.length} database${databases.length !== 1 ? 's' : ''}
              </div>`}
          </div>
          <button class="btn btn-primary btn-sm" onClick=${() => setShowCreate(true)}>+ Create Database</button>
        </div>

        ${error ? html`
          <div class="empty">
            <div class="empty-title" style=${{ color: 'var(--err)' }}>Could not load databases</div>
            <div class="empty-desc">${error?.detail || String(error)}</div>
          </div>` : html`
          <${Table} columns=${cols} rows=${rows} loading=${loading}
            empty=${{ title: 'No databases', desc: 'Create a database to get started.' }}
            renderActions=${row => html`
              <button class="btn btn-ghost btn-sm" onClick=${() => setClearTarget(row.name)}>Clear</button>
              <button class="btn btn-danger btn-sm" onClick=${() => setDropTarget(row.name)}>Drop</button>
            `}
          />`}
      </div>

      ${showCreate && html`<${CreateDatabaseModal} onClose=${() => setShowCreate(false)} onCreated=${refetch} />`}

      ${clearTarget && html`
        <${SdkConfirmModal} open=${true} title="Clear Database" danger=${true}
          message=${`Remove all collections from "${clearTarget}"? The database and user permissions are kept.`}
          onClose=${() => setClearTarget(null)} onConfirm=${handleClear} />`}

      ${dropTarget && html`
        <${SdkConfirmModal} open=${true} title="Drop Database" danger=${true}
          message=${`Drop "${dropTarget}"? All data is permanently deleted. Users keep their accounts but lose permissions on this database.`}
          onClose=${() => setDropTarget(null)} onConfirm=${handleDrop} />`}`;
  }

  // ── Users tab ─────────────────────────────────────────────────────────────

  function RoleChips({ roles, authDb, username, onChanged }) {
    const { ok, err } = useToast();
    if (!roles || roles.length === 0) {
      return html`<span style=${{ color: 'var(--text-3)', fontSize: 12 }}>No roles</span>`;
    }
    return html`
      <div style=${{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        ${roles.map((r, i) => html`
          <span key=${i} style=${{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            background: 'rgba(59,130,246,0.1)', color: '#60a5fa',
            borderRadius: 4, padding: '2px 6px 2px 8px',
            fontSize: 11, fontFamily: 'var(--font-mono)',
          }}>
            <span style=${{ color: '#93c5fd' }}>${r.db}</span>
            <span style=${{ color: 'rgba(96,165,250,0.4)' }}>:</span>
            <span>${r.role}</span>
            <button title="Revoke" onClick=${async () => {
                try {
                  await sdk.fetch('DELETE', `/cpanelapi/mongodb/users/${authDb}/${username}/roles/${r.db}/${r.role}`);
                  ok(`Revoked ${r.role} on ${r.db}.`);
                  onChanged();
                } catch (e) { err(e?.detail || 'Failed to revoke.'); }
              }} style=${{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'rgba(96,165,250,0.5)', padding: '0 0 0 2px',
                lineHeight: 1, fontSize: 13, display: 'flex', alignItems: 'center',
              }}>×</button>
          </span>`)}
      </div>`;
  }

  function ManageRolesModal({ authDb, username, roles: initialRoles, databases, onClose, onChanged }) {
    const { ok, err } = useToast();
    const [currentRoles, setCurrentRoles] = useState(initialRoles || []);
    const [db, setDb] = useState(databases?.[0]?.name || '');
    const [customDb, setCustomDb] = useState('');
    const [role, setRole] = useState('readWrite');
    const [saving, setSaving] = useState(false);
    const [formError, setFormError] = useState('');

    const targetDb = db === '__custom__' ? customDb.trim() : db;

    async function refreshRoles() {
      try {
        const users = await sdk.fetch('GET', '/cpanelapi/mongodb/users');
        const me = (users || []).find(u => u.username === username && u.auth_db === authDb);
        if (me) setCurrentRoles(me.roles || []);
        onChanged();
      } catch (_) {}
    }

    async function handleGrant() {
      if (!targetDb) { setFormError('Database is required.'); return; }
      setSaving(true); setFormError('');
      try {
        await sdk.fetch('POST', `/cpanelapi/mongodb/users/${authDb}/${username}/roles`, { db: targetDb, role });
        ok(`Granted ${role} on ${targetDb} to ${username}.`);
        await refreshRoles();
      } catch (e) {
        const msg = e?.detail || 'Failed to grant role.';
        setFormError(msg); err(msg);
      } finally { setSaving(false); }
    }

    return html`
      <div class="modal-overlay" onClick=${e => e.target === e.currentTarget && onClose()}>
        <div class="modal animate-fade-in" style=${{ width: 480 }}>
          <div class="modal-header">
            <span class="modal-title">Manage Roles</span>
            <button class="modal-close" onClick=${onClose}>×</button>
          </div>
          <div class="modal-body" style=${{ padding: 0 }}>
            <div style=${{
              padding: '14px 20px', background: 'var(--bg-2)',
              borderBottom: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <div style=${{
                width: 36, height: 36, borderRadius: '50%',
                background: 'rgba(59,130,246,0.15)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 15, fontWeight: 600, color: '#60a5fa', fontFamily: 'var(--font-mono)',
              }}>${username[0]?.toUpperCase()}</div>
              <div>
                <div style=${{ fontFamily: 'var(--font-mono)', fontWeight: 500, fontSize: 14, color: 'var(--text-1)' }}>${username}</div>
                <div style=${{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>auth db: ${authDb}</div>
              </div>
            </div>

            <div style=${{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
              <div style=${{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', marginBottom: 10, letterSpacing: '0.06em' }}>CURRENT ROLES</div>
              <${RoleChips} roles=${currentRoles} authDb=${authDb} username=${username} onChanged=${refreshRoles} />
            </div>

            <div style=${{ padding: '16px 20px' }}>
              <div style=${{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', marginBottom: 12, letterSpacing: '0.06em' }}>GRANT NEW ROLE</div>
              <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div class="field" style=${{ marginBottom: 0 }}>
                  <label>DATABASE</label>
                  <select value=${db} onChange=${e => { setDb(e.target.value); setFormError(''); }}>
                    ${(databases || []).map(d => html`<option value=${d.name}>${d.name}</option>`)}
                    <option value="__custom__">Other…</option>
                  </select>
                </div>
                <div class="field" style=${{ marginBottom: 0 }}>
                  <label>ROLE</label>
                  <select value=${role} onChange=${e => setRole(e.target.value)}>
                    <option value="readWrite">readWrite</option>
                    <option value="read">read</option>
                    <option value="dbAdmin">dbAdmin</option>
                    <option value="dbOwner">dbOwner</option>
                  </select>
                </div>
              </div>
              ${db === '__custom__' && html`
                <div class="field" style=${{ marginTop: 10, marginBottom: 0 }}>
                  <label>DATABASE NAME</label>
                  <input type="text" placeholder="database name"
                    value=${customDb} onInput=${e => setCustomDb(e.target.value)} />
                </div>`}
              ${formError && html`<div style=${{ color: 'var(--err)', fontSize: 12, marginTop: 10 }}>${formError}</div>`}
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost btn-sm" onClick=${onClose}>Close</button>
            <button class="btn btn-primary btn-sm" onClick=${handleGrant} disabled=${saving}>
              ${saving ? 'Granting…' : 'Grant Role'}
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
        <div class="modal animate-fade-in" style=${{ width: 400 }}>
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
              ${saving ? 'Saving…' : 'Update Password'}
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
                <input type="password" autocomplete="new-password" placeholder="••••••••"
                  value=${password} onInput=${e => { setPassword(e.target.value); setFormError(''); }} />
              </div>
            </div>
            <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div class="field">
                <label>AUTH DATABASE</label>
                <select value=${authDb} onChange=${e => { setAuthDb(e.target.value); setFormError(''); }}>
                  ${(databases || []).map(d => html`<option value=${d.name}>${d.name}</option>`)}
                  <option value="__custom__">Other…</option>
                </select>
              </div>
              <div class="field">
                <label>INITIAL ROLE</label>
                <select value=${role} onChange=${e => setRole(e.target.value)}>
                  <option value="readWrite">readWrite</option>
                  <option value="read">read</option>
                  <option value="dbAdmin">dbAdmin</option>
                  <option value="dbOwner">dbOwner</option>
                </select>
              </div>
            </div>
            ${authDb === '__custom__' && html`
              <div class="field">
                <label>DATABASE NAME</label>
                <input type="text" placeholder="database name"
                  value=${customDb} onInput=${e => setCustomDb(e.target.value)} />
              </div>`}
            <div style=${{ color: 'var(--text-3)', fontSize: 12, lineHeight: 1.6 }}>
              The auth database is where this user's credentials are stored.
              Additional permissions can be granted after creation.
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
    const [lang, setLang] = useState('mongosh');
    if (!user) return null;

    const host = '127.0.0.1';
    const base = `mongodb://${user.username}:<password>@${host}:${port}/${user.auth_db}`;
    const snippets = {
      mongosh: `mongosh "${base}"`,
      nodejs:  `mongoose.connect('${base}')`,
      python:  `MongoClient('${base}')`,
    };

    return html`
      <div style=${{
        marginTop: 20, borderRadius: 8, overflow: 'hidden',
        border: '1px solid var(--border)',
      }}>
        <div style=${{
          padding: '10px 16px', background: 'var(--bg-2)',
          borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style=${{ fontSize: 13, color: 'var(--text-2)' }}>
            Connect as <span style=${{ fontFamily: 'var(--font-mono)', color: 'var(--primary)' }}>${user.username}</span>
          </div>
          <div style=${{ display: 'flex', background: 'var(--bg-3)', borderRadius: 6, padding: 2 }}>
            ${['mongosh', 'nodejs', 'python'].map(l => html`
              <button key=${l} onClick=${() => setLang(l)} style=${{
                padding: '3px 10px', fontSize: 11, border: 'none', cursor: 'pointer',
                borderRadius: 4, fontWeight: 500, transition: 'background 0.15s',
                background: lang === l ? 'var(--primary)' : 'transparent',
                color: lang === l ? '#fff' : 'var(--text-3)',
              }}>${l}</button>`)}
          </div>
        </div>
        <div style=${{
          padding: '12px 16px', background: 'var(--bg-3)',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <code style=${{
            fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-1)',
            wordBreak: 'break-all', flex: 1, lineHeight: 1.6,
          }}>${snippets[lang]}</code>
          <${CopyButton} text=${snippets[lang]} />
        </div>
        <div style=${{
          padding: '8px 16px', background: 'var(--bg-2)',
          fontSize: 12, color: 'var(--text-3)', lineHeight: 1.5,
        }}>
          Replace <code style=${{ background: 'var(--bg-3)', padding: '1px 5px', borderRadius: 3 }}>&lt;password&gt;</code> with the actual password.
          For external access replace <code style=${{ background: 'var(--bg-3)', padding: '1px 5px', borderRadius: 3 }}>127.0.0.1</code> with your server hostname.
        </div>
      </div>`;
  }

  function UsersTab({ statusData }) {
    const { ok, err } = useToast();
    const port = statusData?.port || 27017;

    const { data: users, loading, error, refetch } = useApi(
      () => sdk.fetch('GET', '/cpanelapi/mongodb/users'),
    );
    const { data: databases } = useApi(() => sdk.fetch('GET', '/cpanelapi/mongodb/databases'));

    const [showCreate, setShowCreate] = useState(false);
    const [grantTarget, setGrantTarget] = useState(null);
    const [pwdTarget, setPwdTarget] = useState(null);
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [deleting, setDeleting] = useState(false);
    const [connUser, setConnUser] = useState(null);

    async function handleDelete() {
      if (!deleteTarget) return; setDeleting(true);
      try {
        await sdk.fetch('DELETE', `/cpanelapi/mongodb/users/${deleteTarget.auth_db}/${deleteTarget.username}`);
        ok(`User "${deleteTarget.username}" deleted.`);
        setDeleteTarget(null);
        if (connUser?.username === deleteTarget.username) setConnUser(null);
        refetch();
      } catch (e) { err(e?.detail || 'Failed to delete user.'); setDeleteTarget(null); }
      finally { setDeleting(false); }
    }

    const cols = [
      { key: 'nameCell',   label: 'Username' },
      { key: 'authDbCell', label: 'Auth DB' },
      { key: 'rolesCell',  label: 'Roles' },
    ];

    const rows = (users || []).map(u => ({
      ...u,
      nameCell:   html`<span style=${{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>${u.username}</span>`,
      authDbCell: html`<${Badge} color="blue">${u.auth_db}</${Badge}>`,
      rolesCell:  html`<${RoleChips} roles=${u.roles} authDb=${u.auth_db} username=${u.username} onChanged=${refetch} />`,
    }));

    return html`
      <div class="card">
        <div style=${{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <div class="card-title" style=${{ marginBottom: 2 }}>Users</div>
            ${!loading && users?.length > 0 && html`
              <div style=${{ fontSize: 12, color: 'var(--text-3)' }}>
                ${users.length} user${users.length !== 1 ? 's' : ''}
              </div>`}
          </div>
          <button class="btn btn-primary btn-sm" onClick=${() => setShowCreate(true)}>+ Create User</button>
        </div>

        ${error ? html`
          <div class="empty">
            <div class="empty-title" style=${{ color: 'var(--err)' }}>Could not load users</div>
            <div class="empty-desc">${error?.detail || String(error)}</div>
          </div>` : html`
          <${Table} columns=${cols} rows=${rows} loading=${loading}
            empty=${{ title: 'No users', desc: 'Create a user to get started.' }}
            renderActions=${row => html`
              <button class="btn btn-ghost btn-sm"
                style=${{ color: connUser?.username === row.username ? 'var(--primary)' : '' }}
                onClick=${() => setConnUser(connUser?.username === row.username ? null : row)}>
                ${connUser?.username === row.username ? 'Hide' : 'Connect'}
              </button>
              <button class="btn btn-ghost btn-sm" onClick=${() => setGrantTarget(row)}>Manage Roles</button>
              <button class="btn btn-ghost btn-sm" onClick=${() => setPwdTarget(row)}>Password</button>
              <button class="btn btn-danger btn-sm" onClick=${() => setDeleteTarget(row)}>Delete</button>
            `}
          />`}

        <${ConnectionStringPanel} user=${connUser} port=${port} />
      </div>

      ${showCreate && html`
        <${CreateUserModal} databases=${databases || []}
          onClose=${() => setShowCreate(false)} onCreated=${refetch} />`}

      ${grantTarget && html`
        <${ManageRolesModal}
          authDb=${grantTarget.auth_db} username=${grantTarget.username}
          roles=${grantTarget.roles} databases=${databases || []}
          onClose=${() => { setGrantTarget(null); refetch(); }}
          onChanged=${refetch} />`}

      ${pwdTarget && html`
        <${ChangePasswordModal} authDb=${pwdTarget.auth_db} username=${pwdTarget.username}
          onClose=${() => setPwdTarget(null)} />`}

      ${deleteTarget && html`
        <${SdkConfirmModal} open=${true} title="Delete User" danger=${true}
          message=${`Delete user "${deleteTarget.username}"? This cannot be undone.`}
          onClose=${() => setDeleteTarget(null)} onConfirm=${handleDelete} />`}`;
  }

  // ── Backups tab ───────────────────────────────────────────────────────────

  function BackupsTab() {
    const { ok, err } = useToast();
    const { data, loading, refetch } = useApi(() => sdk.fetch('GET', '/cpanelapi/mongodb/backups'));
    const { data: dbData } = useApi(() => sdk.fetch('GET', '/cpanelapi/mongodb/databases'));
    const databases = dbData || [];

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
      } catch (e) { err(e?.detail || 'Backup failed.'); }
      finally { setBacking(false); }
    }

    async function handleRestore() {
      if (!restoreTarget) return;
      try {
        await sdk.fetch('POST', '/cpanelapi/mongodb/backups/restore', { name: restoreTarget, drop: dropOnRestore });
        ok(`Restored from "${restoreTarget}".`);
        setRestoreTarget(null);
      } catch (e) { err(e?.detail || 'Restore failed.'); setRestoreTarget(null); }
    }

    async function handleDownload(name) {
      const token = localStorage.getItem('auth_token');
      try {
        const res = await fetch(`/cpanelapi/mongodb/backups/${encodeURIComponent(name)}/download`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) { err('Download failed.'); return; }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `${name}.tar.gz`;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (e) { err('Download failed.'); }
    }

    async function handleDeleteBackup() {
      if (!deleteTarget) return;
      try {
        await sdk.fetch('DELETE', `/cpanelapi/mongodb/backups/${deleteTarget}`);
        ok(`Backup "${deleteTarget}" deleted.`);
        setDeleteTarget(null); refetch();
      } catch (e) { err(e?.detail || 'Failed to delete.'); setDeleteTarget(null); }
    }

    if (!loading && !toolAvailable) {
      return html`
        <div class="card">
          <div class="card-title">Backups</div>
          <div class="empty">
            <div class="empty-title">mongodump not available</div>
            <div class="empty-desc">
              Place <code>mongodump</code> and <code>mongorestore</code> alongside <code>mongod</code>
              in <code>/opt/hostpanel/plugins/mongodb/</code>.
            </div>
          </div>
        </div>`;
    }

    const cols = [
      { key: 'nameCell',   label: 'Name' },
      { key: 'scopeCell',  label: 'Scope' },
      { key: 'dateDisplay', label: 'Created' },
    ];

    const rows = backups.map(b => ({
      ...b,
      nameCell:    html`<span style=${{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>${b.name}</span>`,
      scopeCell:   b.db
        ? html`<${Badge} color="green">${b.db}</${Badge}>`
        : html`<${Badge} color="blue">Full</${Badge}>`,
      dateDisplay: fmtDate(b.created_at),
    }));

    return html`
      <div class="card">
        <div style=${{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <div class="card-title" style=${{ marginBottom: 2 }}>Backups</div>
            ${!loading && backups.length > 0 && html`
              <div style=${{ fontSize: 12, color: 'var(--text-3)' }}>
                ${backups.length} backup${backups.length !== 1 ? 's' : ''}
              </div>`}
          </div>
          <div style=${{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select value=${backupDb} onChange=${e => setBackupDb(e.target.value)} style=${{
              fontSize: 13, padding: '5px 8px', borderRadius: 6,
              border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text-1)',
            }}>
              <option value="__all__">All databases</option>
              ${databases.map(d => html`<option value=${d.name}>${d.name}</option>`)}
            </select>
            <button class="btn btn-primary btn-sm" onClick=${handleBackup} disabled=${backing}>
              ${backing ? 'Backing up…' : 'Backup Now'}
            </button>
          </div>
        </div>

        <${Table} columns=${cols} rows=${rows} loading=${loading}
          empty=${{ title: 'No backups', desc: 'Create your first backup using the button above.' }}
          renderActions=${row => html`
            <button class="btn btn-ghost btn-sm" onClick=${() => setRestoreTarget(row.name)}>Restore</button>
            <button class="btn btn-ghost btn-sm" onClick=${() => handleDownload(row.name)}>Download</button>
            <button class="btn btn-danger btn-sm" onClick=${() => setDeleteTarget(row.name)}>Delete</button>
          `}
        />
      </div>

      ${restoreTarget && html`
        <div class="modal-overlay" onClick=${e => e.target === e.currentTarget && setRestoreTarget(null)}>
          <div class="modal animate-fade-in" style=${{ width: 420 }}>
            <div class="modal-header">
              <span class="modal-title">Restore Backup</span>
              <button class="modal-close" onClick=${() => setRestoreTarget(null)}>×</button>
            </div>
            <div class="modal-body" style=${{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style=${{
                padding: '10px 14px', background: 'var(--bg-2)', borderRadius: 6,
                fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-1)',
                border: '1px solid var(--border)',
              }}>${restoreTarget}</div>
              <label style=${{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked=${dropOnRestore}
                  onChange=${e => setDropOnRestore(e.target.checked)} />
                Drop existing collections before restoring
              </label>
              <div style=${{ color: 'var(--text-3)', fontSize: 12 }}>
                Without "drop", restored data merges with existing collections.
              </div>
            </div>
            <div class="modal-footer">
              <button class="btn btn-ghost btn-sm" onClick=${() => setRestoreTarget(null)}>Cancel</button>
              <button class="btn btn-danger btn-sm" onClick=${handleRestore}>Restore</button>
            </div>
          </div>
        </div>`}

      ${deleteTarget && html`
        <${SdkConfirmModal} open=${true} title="Delete Backup" danger=${true}
          message=${`Permanently delete backup "${deleteTarget}"?`}
          onClose=${() => setDeleteTarget(null)} onConfirm=${handleDeleteBackup} />`}`;
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
        ${tab === 'backups'   && html`<${BackupsTab} />`}
      </div>`;
  }

  sdk.register('mongodb', MongoDBPlugin);
})();
