// VS Code's default shortcuts, checked in VS Code 1.144 on Windows 11 (2026-11) with a clean profile.
// Format is Shift+Alt+F on Windows and Ctrl+Shift+I on Linux (VS Code's Linux default; not checked
// in the app, which isn't installed on the Linux test machines).
LS.ready(() => {
  if (Shard.platform === 'linux') document.getElementById('format').dataset.key = 'ctrl+shift+i';
  // Show each button's combo under its label
  for (const el of document.querySelectorAll('[data-key]')) {
    const label = el.querySelector('.ls-key');
    if (label) label.textContent = LS.keyLabel(el.dataset.key);
  }
});
