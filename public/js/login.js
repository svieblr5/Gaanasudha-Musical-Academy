const form = document.getElementById('loginForm');
const errorEl = document.getElementById('error');

// If already signed in, go straight to the app.
fetch('/api/me')
  .then((r) => r.json())
  .then((d) => {
    if (d.user) location.href = '/';
  })
  .catch(() => {});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.textContent = '';
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      errorEl.textContent = data.error || 'Sign in failed';
      return;
    }
    location.href = '/';
  } catch {
    errorEl.textContent = 'Could not reach the server';
  }
});
