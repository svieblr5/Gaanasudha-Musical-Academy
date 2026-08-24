// ===========================================================================
// cms-client.js — applies the CMS site config to every page: branding, theme
// fonts, announcement banner, footer, hero, and the customised sidebar menu.
// Loads last (after app.js has bound the core nav) so it can safely re-order,
// rename, hide, and extend the menu without breaking existing click handlers.
// ===========================================================================
(function () {
  'use strict';

  const hasSidebar = () => !!document.getElementById('sidebar');

  async function getJSON(url) {
    const r = await fetch(url, { credentials: 'same-origin' });
    if (!r.ok) throw new Error(r.status);
    return r.json();
  }

  async function amAdmin() {
    try {
      const { user } = await getJSON('/api/me');
      return user && user.role === 'admin';
    } catch {
      return false;
    }
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---- Branding: title, logo, favicon, login card ----
  function applyBranding(b) {
    if (!b) return;
    if (b.fullName) {
      const suffix = document.title.includes('·') ? ' ·' + document.title.split('·').slice(1).join('·') : '';
      document.title = b.fullName + suffix;
    }
    if (b.favicon) {
      let link = document.querySelector('link[rel="icon"]');
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
      }
      link.href = b.favicon;
    }

    // Top bar brand (index.html): #brand .logo + .title
    const brand = document.getElementById('brand');
    if (brand) {
      const logo = brand.querySelector('.logo');
      const title = brand.querySelector('.title');
      if (logo) logo.innerHTML = b.logoImage
        ? `<img src="${esc(b.logoImage)}" alt="" style="height:1.4em;width:auto;vertical-align:middle;border-radius:6px" />`
        : esc(b.logoEmoji || '🎼');
      if (title) title.textContent = b.siteName || 'Gaanasudha';
    }

    // Login card (login.html): .brand .logo / h1 / p
    const loginBrand = document.querySelector('.login-card .brand, .login-wrap .brand');
    if (loginBrand) {
      const logo = loginBrand.querySelector('.logo');
      const h1 = loginBrand.querySelector('h1');
      const p = loginBrand.querySelector('p');
      if (logo) logo.innerHTML = b.logoImage
        ? `<img src="${esc(b.logoImage)}" alt="" style="height:64px;width:auto;border-radius:10px" />`
        : esc(b.logoEmoji || '🎼');
      if (h1 && b.loginHeading) h1.textContent = b.loginHeading;
      if (p && b.loginSubtext) p.textContent = b.loginSubtext;
    }
  }

  function injectCustomHead(html) {
    if (!html) return;
    const holder = document.createElement('div');
    holder.innerHTML = html;
    // Move parsed nodes into <head>; re-create <script> so they execute.
    Array.from(holder.childNodes).forEach((node) => {
      if (node.tagName === 'SCRIPT') {
        const s = document.createElement('script');
        for (const a of node.attributes) s.setAttribute(a.name, a.value);
        s.textContent = node.textContent;
        document.head.appendChild(s);
      } else {
        document.head.appendChild(node);
      }
    });
  }

  // ---- Announcement banner (top of page) ----
  function renderAnnouncement(a) {
    if (!a || !a.enabled || !a.text) return;
    if (sessionStorage.getItem('cms-announce-dismissed') === a.text) return;
    const bar = document.createElement('div');
    bar.className = `cms-announce cms-announce-${a.style || 'accent'}`;
    const inner = a.link
      ? `<a href="${esc(a.link)}" target="_blank" rel="noopener">${esc(a.text)}</a>`
      : esc(a.text);
    bar.innerHTML = `<span>${inner}</span>` +
      (a.dismissible ? '<button class="cms-announce-x" aria-label="Dismiss">✕</button>' : '');
    document.body.insertBefore(bar, document.body.firstChild);
    const x = bar.querySelector('.cms-announce-x');
    if (x) x.addEventListener('click', () => {
      sessionStorage.setItem('cms-announce-dismissed', a.text);
      bar.remove();
    });
  }

  function renderFooter(f) {
    if (!f || !f.enabled || !f.text) return;
    const foot = document.createElement('div');
    foot.className = 'cms-footer';
    foot.innerHTML = esc(f.text);
    document.body.appendChild(foot);
  }

  function renderHero(h) {
    if (!h || !h.enabled) return;
    const home = document.getElementById('view-home');
    if (!home) return;
    const hero = document.createElement('div');
    hero.className = 'cms-hero cms-hero-' + (h.align || 'center');
    if (h.image) hero.style.backgroundImage =
      `linear-gradient(rgba(0,0,0,.45),rgba(0,0,0,.55)), url("${h.image.replace(/"/g, '')}")`;
    hero.innerHTML = `<h1>${esc(h.title)}</h1><p>${esc(h.subtitle)}</p>`;
    home.insertBefore(hero, home.firstChild);
  }

  // ---- Sidebar menu: reorder / rename / hide + custom links & pages ----
  function applyNavigation(cfg, isAdmin) {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar || !Array.isArray(cfg.navigation)) return;

    // Map existing core nav nodes by their data-view (keeps their app.js bindings).
    const existing = {};
    sidebar.querySelectorAll('.nav-item[data-view]').forEach((n) => {
      existing[n.dataset.view] = n;
    });

    const frag = document.createDocumentFragment();
    let lastSection = null;

    const addSep = (label) => {
      if (!label || label === lastSection) return;
      const sep = document.createElement('div');
      sep.className = 'nav-sep';
      sep.textContent = label;
      frag.appendChild(sep);
      lastSection = label;
    };

    cfg.navigation.forEach((item) => {
      if (!item.visible) return;
      if (item.adminOnly && !isAdmin) return;
      addSep(item.section);

      let node = existing[item.view];
      if (node && !item.href) {
        node.innerHTML = `<span class="ico">${esc(item.icon)}</span> ${esc(item.label)}`;
        node.style.display = '';
        frag.appendChild(node); // moves the node, preserving its click handler
      } else {
        // Custom / external / href-based link (navigates via location).
        node = document.createElement('div');
        node.className = 'nav-item';
        node.innerHTML = `<span class="ico">${esc(item.icon)}</span> ${esc(item.label)}`;
        const href = item.href || (item.view ? null : '#');
        if (href) node.addEventListener('click', () => { window.location.href = href; });
        frag.appendChild(node);
      }
    });

    // Custom CMS pages that opted into the menu.
    const navPages = (cfg.pages || []).filter((p) => p.showInNav);
    if (navPages.length) {
      addSep('Pages');
      navPages.forEach((p) => {
        const node = document.createElement('div');
        node.className = 'nav-item';
        node.innerHTML = `<span class="ico">${esc(p.icon || '📄')}</span> ${esc(p.title)}`;
        node.addEventListener('click', () => { window.location.href = `/page/${p.slug}`; });
        frag.appendChild(node);
      });
    }

    sidebar.innerHTML = '';
    sidebar.appendChild(frag);
  }

  async function main() {
    let cfg;
    try {
      cfg = await getJSON('/api/cms/config');
    } catch {
      return; // CMS unavailable → leave the shipped defaults untouched
    }
    injectCustomHead(cfg.customHeadHtml);
    applyBranding(cfg.branding);
    renderAnnouncement(cfg.announcement);
    renderFooter(cfg.footer);
    if (hasSidebar()) {
      const isAdmin = await amAdmin();
      applyNavigation(cfg, isAdmin);
      renderHero(cfg.hero);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
  } else {
    main();
  }
})();
