/* Local presentation only: mobile navigation and the four example panels. */
(() => {
  'use strict';
  const header = document.querySelector('[data-toggle-root]');
  const toggle = header?.querySelector('[data-toggle]');
  const close = () => {
    header?.removeAttribute('data-open');
    toggle?.setAttribute('aria-expanded', 'false');
    toggle?.setAttribute('aria-label', '메뉴 열기');
  };
  toggle?.addEventListener('click', () => {
    const open = !header.hasAttribute('data-open');
    header.toggleAttribute('data-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? '메뉴 닫기' : '메뉴 열기');
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && header?.hasAttribute('data-open')) { close(); toggle?.focus(); }
  });
  header?.querySelectorAll('nav a').forEach(link => link.addEventListener('click', close));
  const sections = [...document.querySelectorAll('[data-step]')];
  const views = [...document.querySelectorAll('[data-step-view]')];
  if (!sections.length || sections.length !== views.length) return;
  document.documentElement.setAttribute('data-fx', '');
  const update = () => {
    const at = window.innerHeight * 0.5;
    let index = 0;
    sections.forEach((section, i) => { if (section.getBoundingClientRect().top <= at) index = i; });
    sections.forEach((section, i) => section.toggleAttribute('data-active', i === index));
    views.forEach((view, i) => { view.toggleAttribute('data-active', i === index); view.setAttribute('aria-hidden', String(i !== index)); });
  };
  update();
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update, { passive: true });
})();
