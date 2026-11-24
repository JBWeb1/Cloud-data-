// Cloud Data web dashboard. Plain JavaScript, no build step.
(() => {
  const $ = (sel) => document.querySelector(sel);
  const PAGE_SIZE = 20;

  const state = {
    token: null,
    user: null,
    registering: false,
    collection: null,
    offset: 0,
    total: 0,
  };

  // ---------- helpers ----------

  function readToken() {
    try { return localStorage.getItem('cloud-data-token'); } catch { return null; }
  }
  function saveToken(token) {
    try {
      if (token) localStorage.setItem('cloud-data-token', token);
      else localStorage.removeItem('cloud-data-token');
    } catch { /* storage unavailable: stay signed in for this tab only */ }
  }

  async function api(method, path, body) {
    const res = await fetch(path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(state.token ? { authorization: `Bearer ${state.token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 401 && state.token && !path.startsWith('/api/auth/')) {
      signedOut();
      throw new Error('Your session has ended. Please sign in again.');
    }
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
    return data;
  }

  // Builds an element: el('button', { class: 'x', onclick: fn }, 'text', child)
  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else if (key === 'class') node.className = value;
      else node.setAttribute(key, value);
    }
    for (const child of children.flat()) {
      if (child != null) node.append(child instanceof Node ? child : String(child));
    }
    return node;
  }

  let toastTimer;
  function toast(message) {
    const box = $('#toast');
    box.textContent = message;
    box.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { box.hidden = true; }, 3500);
  }

  // Runs an action and shows any error as a toast.
  function guard(fn) {
    return async (event) => {
      if (event && event.preventDefault) event.preventDefault();
      try {
        await fn(event);
      } catch (err) {
        toast(err.message);
      }
    };
  }

  const fmtDate = (s) => (s ? new Date(s).toLocaleString() : '—');

  function parseJsonObject(text, what) {
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      throw new Error(`${what} is not valid JSON`);
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`${what} must be a JSON object, like {"key": "value"}`);
    }
    return value;
  }

  // ---------- sign in / sign up ----------

  function showAuth() {
    $('#app-view').hidden = true;
    $('#auth-view').hidden = false;
    renderAuthMode();
  }

  function renderAuthMode() {
    const r = state.registering;
    $('#auth-subtitle').textContent = r ? 'Create a new account' : 'Sign in to your account';
    $('#auth-submit').textContent = r ? 'Create account' : 'Sign in';
    $('#auth-switch-text').textContent = r ? 'Already have an account?' : 'No account yet?';
    $('#auth-switch').textContent = r ? 'Sign in' : 'Create one';
    $('#name-field').hidden = !r;
    $('#auth-form').password.autocomplete = r ? 'new-password' : 'current-password';
    $('#auth-error').textContent = '';
  }

  $('#auth-switch').addEventListener('click', () => {
    state.registering = !state.registering;
    renderAuthMode();
  });

  $('#auth-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.target;
    const body = { email: form.email.value, password: form.password.value };
    if (state.registering) body.name = form.name.value;
    $('#auth-error').textContent = '';
    $('#auth-submit').disabled = true;
    try {
      const session = await api('POST', state.registering ? '/api/auth/register' : '/api/auth/login', body);
      form.reset();
      signedIn(session.token, session.user);
    } catch (err) {
      $('#auth-error').textContent = err.message;
    } finally {
      $('#auth-submit').disabled = false;
    }
  });

  function signedIn(token, user) {
    state.token = token;
    state.user = user;
    saveToken(token);
    $('#auth-view').hidden = true;
    $('#app-view').hidden = false;
    $('#who').textContent = user.name || user.email;
    $('#admin-tab').hidden = user.role !== 'admin';
    showTab('data');
  }

  function signedOut() {
    state.token = null;
    state.user = null;
    state.collection = null;
    saveToken(null);
    showAuth();
  }

  $('#logout').addEventListener('click', guard(async () => {
    await api('POST', '/api/auth/logout').catch(() => {});
    signedOut();
  }));

  // ---------- tabs ----------

  function showTab(name) {
    for (const tab of document.querySelectorAll('.tab')) {
      tab.classList.toggle('active', tab.dataset.tab === name);
    }
    $('#tab-data').hidden = name !== 'data';
    $('#tab-account').hidden = name !== 'account';
    $('#tab-admin').hidden = name !== 'admin';
    const loaders = { data: loadCollections, account: loadAccount, admin: loadAdmin };
    guard(loaders[name])();
  }

  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => showTab(tab.dataset.tab));
  }

  // ---------- data ----------

  async function loadCollections() {
    const list = await api('GET', '/api/collections');
    // Keep a newly added (still empty) collection visible.
    if (state.collection && !list.some((c) => c.collection === state.collection)) {
      list.push({ collection: state.collection, count: 0 });
    }
    const ul = $('#collections');
    ul.replaceChildren(...list.map((c) => el('li', {},
      el('button', {
        class: c.collection === state.collection ? 'active' : '',
        onclick: () => openCollection(c.collection),
      }, el('span', {}, c.collection), el('span', { class: 'count' }, c.count)))));
    if (!list.length) ul.replaceChildren(el('li', { class: 'muted' }, 'No collections yet'));
  }

  function openCollection(name) {
    state.collection = name;
    state.offset = 0;
    $('#collection-title').textContent = name;
    $('#collection-actions').hidden = false;
    $('#collection-body').hidden = false;
    guard(async () => {
      await loadCollections();
      await loadItems();
    })();
  }

  async function loadItems() {
    const form = $('#filter');
    const [sort, order] = form.sort.value.split(':');
    const params = new URLSearchParams({
      collection: state.collection, sort, order, limit: PAGE_SIZE, offset: state.offset,
    });
    if (form.where.value.trim()) {
      params.set('where', JSON.stringify(parseJsonObject(form.where.value, 'The filter')));
    }
    const res = await api('GET', `/api/items?${params}`);
    state.total = res.total;

    const from = res.total ? state.offset + 1 : 0;
    const to = state.offset + res.items.length;
    $('#items-count').textContent = `${from}–${to} of ${res.total} item${res.total === 1 ? '' : 's'}`;
    $('#prev').disabled = state.offset === 0;
    $('#next').disabled = to >= res.total;
    $('#items').replaceChildren(...res.items.map(renderItem));
  }

  function renderItem(item) {
    const view = el('pre', {}, JSON.stringify(item.data, null, 2));
    const card = el('div', { class: 'card item' },
      el('div', { class: 'item-head' },
        el('code', {}, item.id),
        el('span', {}, `updated ${fmtDate(item.updated_at)}`)),
      view);

    const editBtn = el('button', { class: 'secondary', onclick: () => startEdit() }, 'Edit');
    const deleteBtn = el('button', {
      class: 'danger',
      onclick: guard(async () => {
        if (!confirm('Delete this item?')) return;
        await api('DELETE', `/api/items/${item.id}`);
        toast('Item deleted');
        await loadCollections();
        await loadItems();
      }),
    }, 'Delete');
    const actions = el('div', { class: 'item-actions' }, editBtn, deleteBtn);
    card.append(actions);

    function startEdit() {
      const area = el('textarea', { rows: '6', spellcheck: 'false' });
      area.value = JSON.stringify(item.data, null, 2);
      view.replaceWith(area);
      actions.replaceChildren(
        el('button', {
          onclick: guard(async () => {
            const data = parseJsonObject(area.value, 'The item');
            await api('PUT', `/api/items/${item.id}`, { data });
            toast('Item saved');
            await loadItems();
          }),
        }, 'Save'),
        el('button', { class: 'secondary', onclick: () => loadItems() }, 'Cancel'),
      );
    }
    return card;
  }

  $('#filter').addEventListener('submit', guard(async () => {
    state.offset = 0;
    await loadItems();
  }));
  $('#prev').addEventListener('click', guard(async () => {
    state.offset = Math.max(0, state.offset - PAGE_SIZE);
    await loadItems();
  }));
  $('#next').addEventListener('click', guard(async () => {
    state.offset += PAGE_SIZE;
    await loadItems();
  }));

  $('#new-item').addEventListener('submit', guard(async (event) => {
    const data = parseJsonObject(event.target.data.value, 'The item');
    await api('POST', '/api/items', { collection: state.collection, data });
    toast('Item created');
    state.offset = 0;
    await loadCollections();
    await loadItems();
  }));

  $('#new-collection').addEventListener('submit', (event) => {
    event.preventDefault();
    const name = event.target.name.value.trim();
    event.target.reset();
    openCollection(name);
    $('#new-item-box').open = true;
  });

  $('#rename-collection').addEventListener('click', guard(async () => {
    const to = prompt('New name for this collection:', state.collection);
    if (!to || to === state.collection) return;
    await api('PATCH', `/api/collections/${encodeURIComponent(state.collection)}`, { name: to });
    toast('Collection renamed');
    openCollection(to);
  }));

  $('#delete-collection').addEventListener('click', guard(async () => {
    if (!confirm(`Delete the collection "${state.collection}" and all of its items?`)) return;
    await api('DELETE', `/api/collections/${encodeURIComponent(state.collection)}`).catch((err) => {
      if (!/not found/i.test(err.message)) throw err; // an empty collection has nothing to delete
    });
    state.collection = null;
    $('#collection-title').textContent = 'Select a collection';
    $('#collection-actions').hidden = true;
    $('#collection-body').hidden = true;
    toast('Collection deleted');
    await loadCollections();
  }));

  // ---------- account ----------

  async function loadAccount() {
    const me = await api('GET', '/api/account');
    const profile = $('#profile');
    profile.name.value = me.name;
    profile.email.value = me.email;
    await Promise.all([loadKeys(), loadSessions()]);
  }

  $('#profile').addEventListener('submit', guard(async (event) => {
    const form = event.target;
    const me = await api('PATCH', '/api/account', { name: form.name.value, email: form.email.value });
    state.user = { ...state.user, ...me };
    $('#who').textContent = me.name || me.email;
    toast('Profile saved');
  }));

  $('#password').addEventListener('submit', guard(async (event) => {
    const form = event.target;
    await api('POST', '/api/account/password', {
      current_password: form.current_password.value,
      new_password: form.new_password.value,
    });
    form.reset();
    toast('Password changed');
    await loadSessions();
  }));

  async function loadKeys() {
    const keys = await api('GET', '/api/account/keys');
    const table = $('#keys');
    if (!keys.length) {
      table.replaceChildren(el('tr', {}, el('td', { class: 'muted' }, 'No API keys yet')));
      return;
    }
    table.replaceChildren(
      el('tr', {}, el('th', {}, 'Name'), el('th', {}, 'Key'), el('th', {}, 'Last used'), el('th', {}, '')),
      ...keys.map((k) => el('tr', {},
        el('td', {}, k.name),
        el('td', {}, el('code', {}, `${k.prefix}…`)),
        el('td', {}, fmtDate(k.last_used_at)),
        el('td', {}, el('button', {
          class: 'danger',
          onclick: guard(async () => {
            if (!confirm(`Revoke the key "${k.name}"? Apps using it will stop working.`)) return;
            await api('DELETE', `/api/account/keys/${k.id}`);
            $('#key-reveal').hidden = true;
            toast('Key revoked');
            await loadKeys();
          }),
        }, 'Revoke')))),
    );
  }

  $('#new-key').addEventListener('submit', guard(async (event) => {
    const created = await api('POST', '/api/account/keys', { name: event.target.name.value });
    event.target.reset();
    $('#key-value').textContent = created.key;
    $('#mcp-snippet').textContent = JSON.stringify({
      mcpServers: {
        'cloud-data': {
          command: 'npx',
          args: ['-y', 'mcp-remote', `${location.origin}/mcp`, '--header', 'Authorization:${AUTH_HEADER}'],
          env: { AUTH_HEADER: `Bearer ${created.key}` },
        },
      },
    }, null, 2);
    $('#key-reveal').hidden = false;
    await loadKeys();
  }));

  async function loadSessions() {
    const sessions = await api('GET', '/api/account/sessions');
    $('#sessions').replaceChildren(
      el('tr', {}, el('th', {}, 'Signed in'), el('th', {}, 'Last active'), el('th', {}, 'Expires')),
      ...sessions.map((s) => el('tr', {},
        el('td', {}, fmtDate(s.created_at), s.current ? ' (this device)' : ''),
        el('td', {}, fmtDate(s.last_used_at)),
        el('td', {}, fmtDate(s.expires_at)))),
    );
  }

  $('#logout-others').addEventListener('click', guard(async () => {
    await api('DELETE', '/api/account/sessions');
    toast('Other devices signed out');
    await loadSessions();
  }));

  $('#export').addEventListener('click', guard(async () => {
    const data = await api('GET', '/api/account/export');
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const link = el('a', { href: url, download: 'cloud-data-export.json' });
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }));

  $('#delete-account').addEventListener('submit', guard(async (event) => {
    if (!confirm('Permanently delete your account and ALL of your data? This cannot be undone.')) return;
    await api('DELETE', '/api/account', { password: event.target.password.value });
    signedOut();
    toast('Account deleted');
  }));

  // ---------- admin ----------

  async function loadAdmin() {
    const [stats, list] = await Promise.all([api('GET', '/api/admin/stats'), api('GET', '/api/admin/users?limit=500')]);
    const labels = {
      users: 'Users', items: 'Items', collections: 'Collections', active_sessions: 'Active sessions', api_keys: 'API keys',
    };
    $('#stats').replaceChildren(...Object.entries(labels).map(([key, label]) => el('div', { class: 'stat' },
      el('div', { class: 'value' }, stats[key]), el('div', { class: 'label' }, label))));

    $('#users').replaceChildren(
      el('tr', {}, el('th', {}, 'Email'), el('th', {}, 'Name'), el('th', {}, 'Items'),
        el('th', {}, 'Joined'), el('th', {}, 'Role'), el('th', {}, '')),
      ...list.users.map((u) => {
        const isMe = u.id === state.user.id;
        return el('tr', {},
          el('td', {}, u.email),
          el('td', {}, u.name),
          el('td', {}, u.item_count),
          el('td', {}, new Date(u.created_at).toLocaleDateString()),
          el('td', {}, el('button', {
            class: 'secondary',
            onclick: guard(async () => {
              await api('PATCH', `/api/admin/users/${u.id}`, { role: u.role === 'admin' ? 'user' : 'admin' });
              await loadAdmin();
            }),
          }, u.role === 'admin' ? 'Admin ✓' : 'Make admin')),
          el('td', {}, isMe ? '' : el('button', {
            class: 'danger',
            onclick: guard(async () => {
              if (!confirm(`Delete ${u.email} and all of their data?`)) return;
              await api('DELETE', `/api/admin/users/${u.id}`);
              toast('User deleted');
              await loadAdmin();
            }),
          }, 'Delete')));
      }),
    );
  }

  // ---------- start ----------

  (async () => {
    const token = readToken();
    if (!token) return showAuth();
    state.token = token;
    try {
      const me = await api('GET', '/api/account');
      signedIn(token, me);
    } catch {
      signedOut();
    }
  })();
})();
