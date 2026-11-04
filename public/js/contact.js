(function () {
  var form = document.getElementById('leadForm');
  var note = document.getElementById('leadNotice');
  if (!form) return;

  function show(kind, text) {
    note.className = 'notice show ' + kind;
    note.textContent = text;
    note.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = form.querySelector('button[type=submit]');
    var data = {};
    new FormData(form).forEach(function (v, k) { data[k] = v; });
    btn.disabled = true;
    btn.textContent = 'Sending...';
    fetch('/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
      .then(function (res) {
        if (res.ok) {
          form.reset();
          show('ok', 'Thank you. We have your message and will get back to you soon.');
        } else {
          show('err', res.body.error || 'Could not send. Please try again.');
        }
      })
      .catch(function () { show('err', 'Network problem. Please try again or message us on WhatsApp.'); })
      .then(function () { btn.disabled = false; btn.textContent = 'Send enquiry'; });
  });
})();
