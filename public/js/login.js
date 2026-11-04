(function () {
  var form = document.getElementById('loginForm');
  var note = document.getElementById('loginNotice');

  // already signed in? go straight to the workspace
  fetch('/api/me').then(function (r) { if (r.ok) location.replace('/app'); });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = form.querySelector('button');
    btn.disabled = true;
    fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: form.email.value, password: form.password.value }),
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
      .then(function (res) {
        if (res.ok) return location.assign('/app');
        note.className = 'notice show err';
        note.textContent = res.body.error || 'Could not sign in.';
        btn.disabled = false;
      })
      .catch(function () {
        note.className = 'notice show err';
        note.textContent = 'Network problem. Please try again.';
        btn.disabled = false;
      });
  });
})();
