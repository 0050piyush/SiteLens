// Applies the saved theme before first paint (kept external for the CSP).
try {
  const t = localStorage.getItem('sitelens-theme');
  if (t) document.documentElement.dataset.theme = t;
} catch { /* storage unavailable */ }
