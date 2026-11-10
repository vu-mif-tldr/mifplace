// Sends a form or a button click to the waitlist API on the same origin and shows the answer.
// The API answers {"success": true} or {"success": false, "error": "..."} (docs/api.md).
async function waitlistPost(path, body) {
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.success) return { ok: true };
    if (res.status === 429)
      return { ok: false, error: 'Too many attempts, please try again later.' };
    return { ok: false, error: data.error || 'Something went wrong, please try again later.' };
  } catch {
    return { ok: false, error: 'No connection, please try again.' };
  }
}

function showStatus(element, result, okText) {
  element.textContent = result.ok ? okText : result.error;
  element.className = 'status ' + (result.ok ? 'ok' : 'error');
}

// The token from ?t=... in the email link
function linkToken() {
  return new URLSearchParams(location.search).get('t') || '';
}

// A page with one button (confirm, unsubscribe): the action runs only on a click, never on
// load, because mail scanners such as Outlook Safe Links open every link in an email.
function tokenButton(path, okText) {
  const button = document.getElementById('action');
  const status = document.getElementById('status');
  const token = linkToken();
  if (!token) {
    button.disabled = true;
    showStatus(status, {
      ok: false,
      error: 'This link is incomplete. Open it from the email again.',
    });
    return;
  }
  button.addEventListener('click', async () => {
    button.disabled = true;
    const result = await waitlistPost(path, { token });
    showStatus(status, result, okText);
    if (result.ok) button.classList.add('hidden');
    else button.disabled = false;
  });
}
