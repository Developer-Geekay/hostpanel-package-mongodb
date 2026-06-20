/* hostpanel-package-mongodb — frontend/main.js
 * Registered as window.__hpkg_sdk.register('mongodb', MongoDBPlugin).
 * Uses HostPanel SDK, CSS variables, and standard classes throughout.
 */
(function () {
  'use strict';

  const sdk = window.__hpkg_sdk;
  const { html, useState, useEffect, useCallback } = sdk;
  const { SdkDataTable, SdkConfirmModal } = sdk.components;
  const { useApi, useToast } = sdk.hooks;

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function formatSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return Math.round(bytes / 1024) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  // ── Change Password Modal ─────────────────────────────────────────────────────

  function ChangePasswordModal({ dbName, username, onClose, onSaved }) {
    const { ok, err } = useToast();
    const [password, setPassword] = useState('');
    const [saving, setSaving] = useState(false);
    const [formError, setFormError] = useState('');

    async function handleSave() {
      if (!password) {
        setFormError('Password is required.');
        return;
      }
      setSaving(true);
      setFormError('');
      try {
        await sdk.fetch('PUT', `/cpanelapi/mongodb/databases/${dbName}/users/${username}/password`, { password });
        ok('Password updated.');
        onSaved();
        onClose();
      } catch (e) {
        const msg = e?.detail || e?.message || 'Failed to update password.';
        setFormError(msg);
        err(msg);
      } finally {
        setSaving(false);
      }
    }

    function handleOverlayClick(e) {
      if (e.target === e.currentTarget) onClose();
    }

    return html`
      <div class="modal-overlay" onClick=${handleOverlayClick}>
        <div class="modal animate-fade-in" style=${{ width: 420 }}>
          <div class="modal-header">
            <span class="modal-title">Change Password — ${username}</span>
            <button class="modal-close" onClick=${onClose} aria-label="Close">×</button>
          </div>
          <div class="modal-body" style=${{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div class="field">
              <label>New password</label>
              <input
                type="password"
                autocomplete="new-password"
                placeholder="Enter new password"
                value=${password}
                onInput=${e => { setPassword(e.target.value); setFormError(''); }}
                onKeyDown=${e => e.key === 'Enter' && handleSave()}
              />
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
      </div>
    `;
  }

  // ── Users Modal ───────────────────────────────────────────────────────────────

  function UsersModal({ dbName, onClose }) {
    const { ok, err } = useToast();
    const [users, setUsers] = useState([]);
    const [loadingUsers, setLoadingUsers] = useState(true);
    const [usersError, setUsersError] = useState('');

    const [showAddForm, setShowAddForm] = useState(false);
    const [newUsername, setNewUsername] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [newRole, setNewRole] = useState('readWrite');
    const [addError, setAddError] = useState('');
    const [adding, setAdding] = useState(false);

    const [deleteTarget, setDeleteTarget] = useState(null);
    const [deleting, setDeleting] = useState(false);

    const [pwdTarget, setPwdTarget] = useState(null);

    const loadUsers = useCallback(async () => {
      setLoadingUsers(true);
      setUsersError('');
      try {
        const data = await sdk.fetch('GET', `/cpanelapi/mongodb/databases/${dbName}/users`);
        setUsers(data || []);
      } catch (e) {
        setUsersError(e?.detail || e?.message || 'Could not load users.');
      } finally {
        setLoadingUsers(false);
      }
    }, [dbName]);

    useEffect(() => { loadUsers(); }, [loadUsers]);

    async function handleAddUser() {
      if (!newUsername.trim()) { setAddError('Username is required.'); return; }
      if (!newPassword) { setAddError('Password is required.'); return; }
      setAdding(true);
      setAddError('');
      try {
        await sdk.fetch('POST', `/cpanelapi/mongodb/databases/${dbName}/users`, {
          username: newUsername.trim(),
          password: newPassword,
          role: newRole,
        });
        ok(`User "${newUsername.trim()}" created.`);
        setNewUsername('');
        setNewPassword('');
        setNewRole('readWrite');
        setShowAddForm(false);
        loadUsers();
      } catch (e) {
        const msg = e?.detail || e?.message || 'Failed to create user.';
        setAddError(msg);
        err(msg);
      } finally {
        setAdding(false);
      }
    }

    async function handleDeleteUser() {
      if (!deleteTarget) return;
      setDeleting(true);
      try {
        await sdk.fetch('DELETE', `/cpanelapi/mongodb/databases/${dbName}/users/${deleteTarget}`);
        ok(`User "${deleteTarget}" deleted.`);
        setDeleteTarget(null);
        loadUsers();
      } catch (e) {
        err(e?.detail || e?.message || 'Failed to delete user.');
        setDeleteTarget(null);
      } finally {
        setDeleting(false);
      }
    }

    function handleOverlayClick(e) {
      if (e.target === e.currentTarget) onClose();
    }

    const userColumns = [
      { key: 'username', label: 'Username', type: 'mono' },
      { key: 'rolesDisplay', label: 'Roles' },
    ];

    const userRows = users.map(u => ({
      ...u,
      rolesDisplay: u.roles.join(', ') || '—',
    }));

    return html`
      <div class="modal-overlay" onClick=${handleOverlayClick}>
        <div class="modal animate-fade-in" style=${{ width: 580, maxWidth: '95vw' }}>
          <div class="modal-header">
            <span class="modal-title">Users — ${dbName}</span>
            <button class="modal-close" onClick=${onClose} aria-label="Close">×</button>
          </div>
          <div class="modal-body" style=${{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            ${usersError && html`
              <div class="empty">
                <div class="empty-title" style=${{ color: 'var(--err)' }}>Could not load users</div>
                <div class="empty-desc">${usersError}</div>
              </div>
            `}
            ${!usersError && html`
              <${SdkDataTable}
                columns=${userColumns}
                rows=${userRows}
                loading=${loadingUsers}
                empty=${{ title: 'No users', desc: 'Add a user to grant database access.' }}
                renderActions=${(row) => html`
                  <button
                    class="btn btn-ghost btn-sm"
                    onClick=${() => setPwdTarget(row.username)}
                  >Change Password</button>
                  <button
                    class="btn btn-danger btn-sm"
                    onClick=${() => setDeleteTarget(row.username)}
                  >Delete</button>
                `}
              />
            `}

            ${showAddForm && html`
              <div style=${{ borderTop: '1px solid var(--border)', paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <span class="card-title" style=${{ marginBottom: 0 }}>Add User</span>
                <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div class="field">
                    <label>Username</label>
                    <input
                      type="text"
                      placeholder="Username"
                      value=${newUsername}
                      onInput=${e => { setNewUsername(e.target.value); setAddError(''); }}
                    />
                  </div>
                  <div class="field">
                    <label>Password</label>
                    <input
                      type="password"
                      autocomplete="new-password"
                      placeholder="Password"
                      value=${newPassword}
                      onInput=${e => { setNewPassword(e.target.value); setAddError(''); }}
                    />
                  </div>
                </div>
                <div class="field">
                  <label>Role</label>
                  <select value=${newRole} onChange=${e => setNewRole(e.target.value)}>
                    <option value="readWrite">readWrite</option>
                    <option value="read">read</option>
                    <option value="dbAdmin">dbAdmin</option>
                    <option value="dbOwner">dbOwner</option>
                  </select>
                </div>
                ${addError && html`<div style=${{ color: 'var(--err)', fontSize: 12 }}>${addError}</div>`}
                <div style=${{ display: 'flex', gap: 8 }}>
                  <button class="btn btn-primary btn-sm" onClick=${handleAddUser} disabled=${adding}>
                    ${adding ? 'Creating…' : 'Create User'}
                  </button>
                  <button class="btn btn-ghost btn-sm" onClick=${() => { setShowAddForm(false); setAddError(''); setNewUsername(''); setNewPassword(''); setNewRole('readWrite'); }}>
                    Cancel
                  </button>
                </div>
              </div>
            `}
          </div>
          <div class="modal-footer">
            ${!showAddForm && html`
              <button class="btn btn-primary btn-sm" onClick=${() => setShowAddForm(true)}>+ Add User</button>
            `}
            <button class="btn btn-ghost btn-sm" onClick=${onClose}>Close</button>
          </div>
        </div>
      </div>

      ${deleteTarget && html`
        <${SdkConfirmModal}
          open=${true}
          title="Delete User"
          message=${`Delete user "${deleteTarget}" from "${dbName}"? This action cannot be undone.`}
          danger=${true}
          onClose=${() => setDeleteTarget(null)}
          onConfirm=${handleDeleteUser}
        />
      `}

      ${pwdTarget && html`
        <${ChangePasswordModal}
          dbName=${dbName}
          username=${pwdTarget}
          onClose=${() => setPwdTarget(null)}
          onSaved=${loadUsers}
        />
      `}
    `;
  }

  // ── Create Database Modal ─────────────────────────────────────────────────────

  function CreateDatabaseModal({ onClose, onCreated }) {
    const { ok, err } = useToast();
    const [name, setName] = useState('');
    const [saving, setSaving] = useState(false);
    const [formError, setFormError] = useState('');

    async function handleCreate() {
      const trimmed = name.trim();
      if (!trimmed) { setFormError('Database name is required.'); return; }
      setSaving(true);
      setFormError('');
      try {
        await sdk.fetch('POST', '/cpanelapi/mongodb/databases', { name: trimmed });
        ok(`Database "${trimmed}" created.`);
        onCreated();
        onClose();
      } catch (e) {
        const msg = e?.detail || e?.message || 'Failed to create database.';
        setFormError(msg);
        err(msg);
      } finally {
        setSaving(false);
      }
    }

    function handleOverlayClick(e) {
      if (e.target === e.currentTarget) onClose();
    }

    return html`
      <div class="modal-overlay" onClick=${handleOverlayClick}>
        <div class="modal animate-fade-in" style=${{ width: 420 }}>
          <div class="modal-header">
            <span class="modal-title">Create Database</span>
            <button class="modal-close" onClick=${onClose} aria-label="Close">×</button>
          </div>
          <div class="modal-body" style=${{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div class="field">
              <label>Database name</label>
              <input
                type="text"
                placeholder="my_database"
                value=${name}
                onInput=${e => { setName(e.target.value); setFormError(''); }}
                onKeyDown=${e => e.key === 'Enter' && handleCreate()}
                autoFocus
              />
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
      </div>
    `;
  }

  // ── Status Bar ────────────────────────────────────────────────────────────────

  function StatusBar() {
    const { data, loading, refetch } = useApi(
      () => sdk.fetch('GET', '/cpanelapi/mongodb/status'),
    );

    useEffect(() => {
      const id = setInterval(refetch, 30000);
      return () => clearInterval(id);
    }, [refetch]);

    if (loading && !data) {
      return html`
        <div style=${{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0', color: 'var(--text-3)', fontSize: 13 }}>
          <span class="dot dot-dim"></span>
          Checking MongoDB status…
        </div>
      `;
    }

    const running = data?.running;
    const version = data?.version;

    return html`
      <div style=${{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0' }}>
        <span class=${running ? 'dot dot-ok' : 'dot dot-dim'}></span>
        <span style=${{ fontSize: 13, fontWeight: 500, color: running ? 'var(--ok)' : 'var(--text-3)' }}>
          ${running
            ? (version ? `MongoDB ${version}` : 'MongoDB running')
            : 'MongoDB offline'}
        </span>
        ${!running && html`
          <span style=${{ fontSize: 12, color: 'var(--text-3)' }}>
            — Service is not reachable. Check the Services page to start mongod.
          </span>
        `}
      </div>
    `;
  }

  // ── Main Plugin ───────────────────────────────────────────────────────────────

  function MongoDBPlugin() {
    const { err } = useToast();
    const { data: databases, loading, error, refetch } = useApi(
      () => sdk.fetch('GET', '/cpanelapi/mongodb/databases'),
    );

    const [showCreate, setShowCreate] = useState(false);
    const [dropTarget, setDropTarget] = useState(null);
    const [dropping, setDropping] = useState(false);
    const [usersDb, setUsersDb] = useState(null);

    async function handleDrop() {
      if (!dropTarget) return;
      setDropping(true);
      try {
        await sdk.fetch('DELETE', `/cpanelapi/mongodb/databases/${dropTarget}`);
        setDropTarget(null);
        refetch();
      } catch (e) {
        err(e?.detail || e?.message || 'Failed to drop database.');
        setDropTarget(null);
      } finally {
        setDropping(false);
      }
    }

    const dbColumns = [
      { key: 'name', label: 'Name', type: 'mono' },
      { key: 'sizeDisplay', label: 'Size' },
    ];

    const dbRows = (databases || []).map(db => ({
      ...db,
      sizeDisplay: formatSize(db.size),
    }));

    return html`
      <div class="page">
        <div class="page-header">
          <div>
            <h1 class="page-title">MongoDB</h1>
            <p class="page-desc">Manage databases, collections, and users.</p>
          </div>
        </div>

        <${StatusBar} />

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
              <div class="empty-desc">${error?.detail || error?.message || String(error)}</div>
            </div>
          `}

          ${!error && html`
            <${SdkDataTable}
              columns=${dbColumns}
              rows=${dbRows}
              loading=${loading}
              empty=${{ title: 'No databases', desc: 'Create a database to get started.' }}
              renderActions=${(row) => html`
                <button
                  class="btn btn-ghost btn-sm"
                  onClick=${() => setUsersDb(row.name)}
                >Users</button>
                <button
                  class="btn btn-danger btn-sm"
                  onClick=${() => setDropTarget(row.name)}
                >Drop</button>
              `}
            />
          `}
        </div>

        ${showCreate && html`
          <${CreateDatabaseModal}
            onClose=${() => setShowCreate(false)}
            onCreated=${refetch}
          />
        `}

        ${dropTarget && html`
          <${SdkConfirmModal}
            open=${true}
            title="Drop Database"
            message=${`Drop database "${dropTarget}"? All collections and data inside will be permanently deleted.`}
            danger=${true}
            onClose=${() => setDropTarget(null)}
            onConfirm=${handleDrop}
          />
        `}

        ${usersDb && html`
          <${UsersModal}
            dbName=${usersDb}
            onClose=${() => setUsersDb(null)}
          />
        `}
      </div>
    `;
  }

  sdk.register('mongodb', MongoDBPlugin);
})();
