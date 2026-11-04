(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var state = { me: null, modules: [], roles: {}, current: null };
  var view = $('view');

  // ---------- helpers ----------
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== false && attrs[k] != null) n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function api(method, url, body) {
    return fetch(url, {
      method: method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401) { location.assign('/login'); throw new Error('auth'); }
        if (!r.ok) throw new Error(j.error || 'Request failed');
        return j;
      });
    });
  }
  var naira = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 2 });
  function fmt(v, f) {
    if (v === null || v === undefined || v === '') return '';
    if (f.money) return naira.format(Number(v));
    if (f.type === 'number' || f.type === 'computed') return String(Number(v));
    return String(v);
  }
  var GOOD = ['Paid', 'Resolved', 'Hired', 'Won', 'Published', 'Activated', 'Income', 'Closed'];
  var WARN = ['Sent', 'In progress', 'Medium', 'Interview', 'Offer', 'Negotiation', 'Scheduled', 'Planned', 'Proposal', 'Contacted', 'Drafting'];
  var BAD = ['Overdue', 'High', 'Critical', 'Open', 'Rejected', 'Lost', 'Expense'];
  function cell(f, v) {
    if (f.type === 'select' && v) {
      var c = GOOD.indexOf(v) > -1 ? 'good' : BAD.indexOf(v) > -1 ? 'bad' : WARN.indexOf(v) > -1 ? 'warn' : '';
      return el('span', { class: 'pill ' + c, text: v });
    }
    return document.createTextNode(fmt(v, f));
  }

  // ---------- computed fields & summaries (mirror the server config) ----------
  function withComputed(mod, data) {
    var out = Object.assign({}, data);
    mod.fields.forEach(function (f) {
      if (f.type !== 'computed') return;
      var c = f.compute, a = Number(data[c.a]), b = Number(data[c.b]);
      if (c.op === 'sub') out[f.key] = (a || 0) - (b || 0);
      else if (c.op === 'mul') out[f.key] = (a || 0) * (b || 0);
      else if (c.op === 'mulsub') out[f.key] = ((a || 0) - (b || 0)) * (Number(data[c.c]) || 0);
    });
    return out;
  }
  function matches(row, where) {
    return Object.keys(where || {}).every(function (k) {
      var w = where[k];
      return Array.isArray(w) ? w.indexOf(row[k]) > -1 : row[k] === w;
    });
  }
  function summarise(mod, rows) {
    return (mod.summary || []).map(function (s) {
      var v = 0;
      if (s.op === 'count') v = rows.filter(function (r) { return matches(r, s.where); }).length;
      else if (s.op === 'sum' || s.op === 'sumComputed')
        v = rows.filter(function (r) { return matches(r, s.where); }).reduce(function (t, r) { return t + (Number(r[s.field]) || 0); }, 0);
      else if (s.op === 'signed')
        v = rows.reduce(function (t, r) {
          var n = Number(r[s.field]) || 0;
          return r[s.key] === s.positive ? t + n : r[s.key] === s.negative ? t - n : t;
        }, 0);
      else if (s.op === 'countNonZero') v = rows.filter(function (r) { return Number(r[s.field]) !== 0; }).length;
      else if (s.op === 'lowStock')
        v = rows.filter(function (r) { return r.reorder !== null && r.reorder !== '' && Number(r.qty) <= Number(r.reorder); }).length;
      return { label: s.label, text: s.money ? naira.format(v) : String(v) };
    });
  }

  // ---------- dialog ----------
  var dlg = $('dlg');
  var dlgSubmit = null;
  function openDialog(title, bodyNodes, onSubmit, saveLabel) {
    $('dlgTitle').textContent = title;
    $('dlgNotice').className = 'notice';
    var body = $('dlgBody');
    body.textContent = '';
    bodyNodes.forEach(function (n) { body.appendChild(n); });
    $('dlgSave').textContent = saveLabel || 'Save';
    dlgSubmit = onSubmit;
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    var first = body.querySelector('input,select,textarea');
    if (first) first.focus();
  }
  function closeDialog() { if (dlg.close) dlg.close(); else dlg.removeAttribute('open'); }
  $('dlgCancel').addEventListener('click', closeDialog);
  $('dlgForm').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!dlgSubmit) return;
    var btn = $('dlgSave');
    btn.disabled = true;
    Promise.resolve(dlgSubmit())
      .then(function () { closeDialog(); })
      .catch(function (err) {
        if (err && err.message === 'auth') return;
        var n = $('dlgNotice');
        n.className = 'notice show err';
        n.textContent = err.message || 'Could not save.';
      })
      .then(function () { btn.disabled = false; });
  });
  function field(id, label, input) {
    return el('div', { class: 'field' }, [el('label', { for: id, text: label }), input]);
  }

  // ---------- generic module view ----------
  function renderModule(id) {
    var mod = state.modules.filter(function (m) { return m.id === id; })[0];
    if (!mod) return renderWelcome();
    state.current = id;
    setTitle(mod.title);
    view.textContent = 'Loading...';
    api('GET', '/api/records/' + id).then(function (res) {
      var rows = res.records.map(function (r) { return { _id: r.id, _data: r.data, row: withComputed(mod, r.data) }; });
      var search = '';

      function draw() {
        view.textContent = '';
        view.appendChild(el('p', { class: 'blurb', text: mod.blurb }));

        var stats = el('div', { class: 'stats' });
        summarise(mod, rows.map(function (r) { return r.row; })).forEach(function (s) {
          stats.appendChild(el('div', { class: 'stat' }, [el('span', { text: s.label }), el('b', { text: s.text })]));
        });
        view.appendChild(stats);

        var q = el('input', { type: 'search', placeholder: 'Search...', 'aria-label': 'Search', value: search });
        q.addEventListener('input', function () { search = q.value.toLowerCase(); drawRows(); });
        view.appendChild(el('div', { class: 'toolbar' }, [
          q, el('span', { class: 'grow' }),
          el('button', { class: 'btn btn-primary btn-sm', type: 'button', text: 'Export CSV', onclick: exportCsv }),
          el('button', { class: 'btn btn-gold btn-sm', type: 'button', text: '+ Add', onclick: function () { editRecord(); } }),
        ]));

        var wrap = el('div', { class: 'table-wrap' });
        view.appendChild(wrap);
        drawRows();
        q.focus && search && q.setSelectionRange(search.length, search.length);

        function drawRows() {
          wrap.textContent = '';
          var shown = rows.filter(function (r) {
            return !search || JSON.stringify(r.row).toLowerCase().indexOf(search) > -1;
          });
          if (!shown.length) {
            wrap.appendChild(el('div', { class: 'empty', text: rows.length ? 'Nothing matches your search.' : 'No records yet. Use "+ Add" to create the first one.' }));
            return;
          }
          var thead = el('tr');
          mod.fields.forEach(function (f) {
            thead.appendChild(el('th', { class: f.type === 'number' || f.type === 'computed' ? 'num' : '', text: f.label }));
          });
          thead.appendChild(el('th'));
          var tbody = el('tbody');
          shown.forEach(function (r) {
            var low = mod.flagLow && r.row[mod.flagLow.reorder] !== null && r.row[mod.flagLow.reorder] !== '' &&
              Number(r.row[mod.flagLow.qty]) <= Number(r.row[mod.flagLow.reorder]);
            var tr = el('tr', { class: low ? 'low' : '' });
            mod.fields.forEach(function (f) {
              var td = el('td', { class: f.type === 'number' || f.type === 'computed' ? 'num' : '' });
              td.appendChild(cell(f, r.row[f.key]));
              tr.appendChild(td);
            });
            tr.appendChild(el('td', { class: 'actions' }, [
              el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'Edit', onclick: function () { editRecord(r); } }),
              ' ',
              el('button', { class: 'btn btn-danger btn-sm', type: 'button', text: 'Delete', onclick: function () { removeRecord(r); } }),
            ]));
            tbody.appendChild(tr);
          });
          wrap.appendChild(el('table', {}, [el('thead', {}, [thead]), tbody]));
        }
      }

      function editRecord(rec) {
        var inputs = {};
        var nodes = [];
        mod.fields.forEach(function (f) {
          if (f.type === 'computed') return;
          var input;
          var id = 'f_' + f.key;
          if (f.type === 'select') {
            input = el('select', { id: id }, [el('option', { value: '', text: 'Choose...' })].concat(f.options.map(function (o) { return el('option', { value: o, text: o }); })));
          } else if (f.type === 'textarea') input = el('textarea', { id: id });
          else input = el('input', { id: id, type: f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text', step: f.type === 'number' ? 'any' : false });
          if (rec && rec._data[f.key] != null) input.value = rec._data[f.key];
          else if (!rec && f.type === 'date' && f.required) input.value = new Date().toISOString().slice(0, 10);
          inputs[f.key] = input;
          nodes.push(field(id, f.label + (f.required ? ' *' : ''), input));
        });
        openDialog((rec ? 'Edit ' : 'Add ') + mod.title.toLowerCase(), nodes, function () {
          var body = {};
          Object.keys(inputs).forEach(function (k) { body[k] = inputs[k].value; });
          var p = rec ? api('PUT', '/api/records/' + id + '/' + rec._id, body) : api('POST', '/api/records/' + id, body);
          return p.then(function (res) {
            var item = { _id: res.record.id, _data: res.record.data, row: withComputed(mod, res.record.data) };
            if (rec) rows = rows.map(function (r) { return r._id === rec._id ? item : r; });
            else rows.unshift(item);
            draw();
          });
        });
      }

      function removeRecord(rec) {
        if (!confirm('Delete this record? This cannot be undone.')) return;
        api('DELETE', '/api/records/' + id + '/' + rec._id).then(function () {
          rows = rows.filter(function (r) { return r._id !== rec._id; });
          draw();
        }).catch(function (e) { alert(e.message); });
      }

      function exportCsv() {
        var cols = mod.fields;
        var esc = function (v) {
          v = v == null ? '' : String(v);
          if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; // stop spreadsheet formula injection
          return '"' + v.replace(/"/g, '""') + '"';
        };
        var lines = [cols.map(function (c) { return esc(c.label); }).join(',')];
        rows.forEach(function (r) { lines.push(cols.map(function (c) { return esc(r.row[c.key]); }).join(',')); });
        var a = el('a', { href: URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv' })), download: id + '.csv' });
        document.body.appendChild(a); a.click(); a.remove();
      }

      draw();
    }).catch(function (e) { if (e.message !== 'auth') view.textContent = e.message; });
  }

  // ---------- welcome ----------
  function renderWelcome() {
    state.current = 'home';
    setTitle('Welcome, ' + state.me.name.split(' ')[0]);
    view.textContent = '';
    view.appendChild(el('p', { class: 'blurb', text: 'You are signed in as ' + state.roles[state.me.role] + '. Choose a tool to get started.' }));
    var grid = el('div', { class: 'welcome' });
    state.modules.forEach(function (m) {
      grid.appendChild(el('button', { class: 'card', type: 'button', onclick: function () { go(m.id); } }, [el('h3', { text: m.title }), el('p', { text: m.blurb })]));
    });
    if (state.me.role === 'admin' || state.me.role === 'sales') {
      grid.appendChild(el('button', { class: 'card', type: 'button', onclick: function () { go('_leads'); } }, [el('h3', { text: 'Website enquiries' }), el('p', { text: 'Messages from the contact form.' })]));
    }
    if (state.me.role === 'admin') {
      grid.appendChild(el('button', { class: 'card', type: 'button', onclick: function () { go('_staff'); } }, [el('h3', { text: 'Staff accounts' }), el('p', { text: 'Create logins and assign roles.' })]));
    }
    view.appendChild(grid);
  }

  // ---------- leads ----------
  function renderLeads() {
    state.current = '_leads';
    setTitle('Website enquiries');
    view.textContent = 'Loading...';
    api('GET', '/api/leads').then(function (res) {
      view.textContent = '';
      view.appendChild(el('p', { class: 'blurb', text: 'Everyone who used the contact form on the website.' }));
      if (!res.leads.length) { view.appendChild(el('div', { class: 'table-wrap' }, [el('div', { class: 'empty', text: 'No enquiries yet.' })])); return; }
      var tbody = el('tbody');
      res.leads.forEach(function (l) {
        var sel = el('select', { 'aria-label': 'Status' }, ['New', 'Contacted', 'Won', 'Closed'].map(function (s) { return el('option', { value: s, text: s }); }));
        sel.value = l.status;
        sel.addEventListener('change', function () { api('PATCH', '/api/leads/' + l.id, { status: sel.value }).catch(function (e) { alert(e.message); }); });
        var del = state.me.role === 'admin'
          ? el('button', { class: 'btn btn-danger btn-sm', type: 'button', text: 'Delete', onclick: function () {
              if (confirm('Delete this enquiry?')) api('DELETE', '/api/leads/' + l.id).then(renderLeads);
            } })
          : null;
        tbody.appendChild(el('tr', {}, [
          el('td', { text: new Date(l.created_at).toLocaleDateString() }),
          el('td', { text: l.name }),
          el('td', { text: [l.email, l.phone].filter(Boolean).join(' / ') }),
          el('td', { text: l.service || '' }),
          el('td', { text: l.message || '' }),
          el('td', {}, [sel]),
          el('td', { class: 'actions' }, [del]),
        ]));
      });
      var head = el('tr', {}, ['Date', 'Name', 'Contact', 'Service', 'Message', 'Status', ''].map(function (h) { return el('th', { text: h }); }));
      view.appendChild(el('div', { class: 'table-wrap' }, [el('table', {}, [el('thead', {}, [head]), tbody])]));
    }).catch(function (e) { if (e.message !== 'auth') view.textContent = e.message; });
  }

  // ---------- staff accounts (admin) ----------
  function roleSelect(id, value) {
    var s = el('select', { id: id }, Object.keys(state.roles).map(function (r) { return el('option', { value: r, text: state.roles[r] }); }));
    if (value) s.value = value;
    return s;
  }
  function renderStaff() {
    state.current = '_staff';
    setTitle('Staff accounts');
    view.textContent = 'Loading...';
    api('GET', '/api/users').then(function (res) {
      view.textContent = '';
      view.appendChild(el('p', { class: 'blurb', text: 'Create a login for each team member. Their role decides which tools they see. Share the password with them privately; they can change it after signing in.' }));
      view.appendChild(el('div', { class: 'toolbar' }, [el('span', { class: 'grow' }), el('button', { class: 'btn btn-gold btn-sm', type: 'button', text: '+ New staff account', onclick: newUser })]));
      var tbody = el('tbody');
      res.users.forEach(function (u) {
        var self = u.id === state.me.id;
        tbody.appendChild(el('tr', {}, [
          el('td', { text: u.name + (self ? ' (you)' : '') }),
          el('td', { text: u.email }),
          el('td', { text: state.roles[u.role] || u.role }),
          el('td', {}, [el('span', { class: 'pill ' + (u.active ? 'good' : 'bad'), text: u.active ? 'Active' : 'Disabled' })]),
          el('td', { class: 'actions' }, self ? [] : [
            el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'Edit', onclick: function () { editUser(u); } }), ' ',
            el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'Reset password', onclick: function () { resetPw(u); } }), ' ',
            el('button', { class: 'btn btn-danger btn-sm', type: 'button', text: 'Delete', onclick: function () {
              if (confirm('Delete ' + u.name + '? They will no longer be able to sign in.')) api('DELETE', '/api/users/' + u.id).then(renderStaff).catch(function (e) { alert(e.message); });
            } }),
          ]),
        ]));
      });
      var head = el('tr', {}, ['Name', 'Email', 'Role', 'Status', ''].map(function (h) { return el('th', { text: h }); }));
      view.appendChild(el('div', { class: 'table-wrap' }, [el('table', {}, [el('thead', {}, [head]), tbody])]));
    }).catch(function (e) { if (e.message !== 'auth') view.textContent = e.message; });
  }
  function newUser() {
    var name = el('input', { id: 'u_name', autocomplete: 'off' });
    var email = el('input', { id: 'u_email', type: 'email', autocomplete: 'off' });
    var role = roleSelect('u_role', 'accountant');
    var pw = el('input', { id: 'u_pw', type: 'text', autocomplete: 'off', minlength: 8 });
    pw.value = Math.random().toString(36).slice(2, 6) + '-' + Math.random().toString(36).slice(2, 8) + '9A';
    openDialog('New staff account', [field('u_name', 'Full name', name), field('u_email', 'Email (their login)', email), field('u_role', 'Role', role), field('u_pw', 'Starting password', pw)], function () {
      return api('POST', '/api/users', { name: name.value, email: email.value, role: role.value, password: pw.value }).then(renderStaff);
    }, 'Create account');
  }
  function editUser(u) {
    var name = el('input', { id: 'e_name', value: u.name });
    var role = roleSelect('e_role', u.role);
    var active = el('select', { id: 'e_active' }, [el('option', { value: '1', text: 'Active' }), el('option', { value: '0', text: 'Disabled' })]);
    active.value = u.active ? '1' : '0';
    openDialog('Edit ' + u.name, [field('e_name', 'Full name', name), field('e_role', 'Role', role), field('e_active', 'Status', active)], function () {
      return api('PATCH', '/api/users/' + u.id, { name: name.value, role: role.value, active: active.value === '1' }).then(renderStaff);
    });
  }
  function resetPw(u) {
    var pw = el('input', { id: 'r_pw', type: 'text', autocomplete: 'off' });
    pw.value = Math.random().toString(36).slice(2, 6) + '-' + Math.random().toString(36).slice(2, 8) + '9A';
    openDialog('Reset password for ' + u.name, [field('r_pw', 'New password', pw)], function () {
      return api('PATCH', '/api/users/' + u.id, { password: pw.value });
    }, 'Set password');
  }

  // ---------- change own password ----------
  $('pwBtn').addEventListener('click', function () {
    var cur = el('input', { id: 'p_cur', type: 'password', autocomplete: 'current-password' });
    var nw = el('input', { id: 'p_new', type: 'password', autocomplete: 'new-password' });
    openDialog('Change password', [field('p_cur', 'Current password', cur), field('p_new', 'New password (8+ characters)', nw)], function () {
      return api('POST', '/api/me/password', { current: cur.value, next: nw.value });
    });
  });
  $('logoutBtn').addEventListener('click', function () {
    api('POST', '/api/auth/logout').then(function () { location.assign('/login'); }).catch(function () { location.assign('/login'); });
  });

  // ---------- navigation ----------
  function setTitle(t) { $('viewTitle').textContent = t; document.title = t + ' | Asotech Workspace'; }
  function go(id) {
    $('side').classList.remove('open');
    Array.prototype.forEach.call($('sideNav').querySelectorAll('button'), function (b) {
      b.setAttribute('aria-current', b.dataset.id === id ? 'true' : 'false');
    });
    if (id === 'home') renderWelcome();
    else if (id === '_leads') renderLeads();
    else if (id === '_staff') renderStaff();
    else renderModule(id);
    try { location.hash = id; } catch (e) {}
    view.focus();
  }
  $('sideToggle').addEventListener('click', function () { $('side').classList.toggle('open'); });

  function buildNav() {
    var nav = $('sideNav');
    nav.textContent = '';
    function btn(id, label) { return el('button', { type: 'button', 'data-id': id, text: label, onclick: function () { go(id); } }); }
    nav.appendChild(btn('home', 'Home'));
    var lastGroup = '';
    state.modules.forEach(function (m) {
      if (m.group !== lastGroup) { nav.appendChild(el('div', { class: 'grp', text: m.group })); lastGroup = m.group; }
      nav.appendChild(btn(m.id, m.title));
    });
    if (state.me.role === 'admin' || state.me.role === 'sales') {
      nav.appendChild(el('div', { class: 'grp', text: 'Website' }));
      nav.appendChild(btn('_leads', 'Enquiries'));
    }
    if (state.me.role === 'admin') {
      nav.appendChild(el('div', { class: 'grp', text: 'Admin' }));
      nav.appendChild(btn('_staff', 'Staff accounts'));
    }
  }

  // ---------- start ----------
  api('GET', '/api/me').then(function (res) {
    state.me = res.user;
    state.modules = res.modules;
    state.roles = res.roles;
    $('whoName').textContent = res.user.name;
    $('whoRole').textContent = res.roleLabel;
    buildNav();
    var start = (location.hash || '').replace('#', '');
    var valid = start === '_leads' ? (res.user.role === 'admin' || res.user.role === 'sales')
      : start === '_staff' ? res.user.role === 'admin'
      : res.modules.some(function (m) { return m.id === start; });
    // staff land straight on their profession's first tool
    if (valid) go(start);
    else if (res.user.role !== 'admin' && res.modules.length > 0) go(res.modules[0].id);
    else go('home');
  }).catch(function () {});
})();
