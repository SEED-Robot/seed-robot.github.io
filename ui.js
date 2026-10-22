'use strict';
(() => {
  const app = document.getElementById('app');
  const toggle = document.getElementById('sidebarToggle');
  const scrim = document.getElementById('scrim');
  function setOpen(open) {
    app.classList.toggle('sidebar-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close controls' : 'Open controls');
    scrim.hidden = !open;
  }
  toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
  scrim.addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') setOpen(false); });
})();
