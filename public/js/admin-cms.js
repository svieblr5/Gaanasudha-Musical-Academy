// ===========================================================================
// admin-cms.js — the Site Builder dashboard. Loads the full CMS config, renders
// section editors (branding, theme, fonts, navigation, pages, announcement,
// hero, footer, features, advanced, backup), and saves back to /api/cms.
// ===========================================================================
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  let cfg = null;
  let fontPresets = {};
  let defaults = null;
  let dirty = false;
  let active = 'branding';

  // ---- tiny DOM helper ----
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (k === 'class') el.className = v;
        else if (k === 'style') el.style.cssText = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'html') el.innerHTML = v;
        else if (v !== null && v !== undefined && v !== false) el.setAttribute(k, v);
      }
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
    }
    return el;
  }

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2200);
  }

  function markDirty() {
    dirty = true;
    const s = $('#savedState');
    s.textContent = 'Unsaved changes';
    s.classList.add('dirty');
  }

  // Reach into cfg by dotted path (e.g. "theme.colors.accent") and set a value.
  function set(path, value) {
    const parts = path.split('.');
    let o = cfg;
    for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
    o[parts[parts.length - 1]] = value;
    markDirty();
  }
  function get(path) {
    return path.split('.').reduce((o, k) => (o == null ? o : o[k]), cfg);
  }

  // ---- field builders ----
  function fieldWrap(label, control, hint) {
    return h('div', { class: 'fgroup' },
      label ? h('label', null, label) : null,
      control,
      hint ? h('div', { class: 'hint2' }, hint) : null);
  }

  function text(path, label, opts = {}) {
    const inp = h('input', {
      type: opts.type || 'text', value: get(path) || '',
      placeholder: opts.placeholder || '',
      oninput: (e) => set(path, e.target.value),
    });
    return fieldWrap(label, inp, opts.hint);
  }

  function textarea(path, label, opts = {}) {
    const ta = h('textarea', {
      placeholder: opts.placeholder || '',
      oninput: (e) => set(path, e.target.value),
    });
    ta.value = get(path) || '';
    if (opts.rows) ta.rows = opts.rows;
    return fieldWrap(label, ta, opts.hint);
  }

  function select(path, label, options, opts = {}) {
    const sel = h('select', { onchange: (e) => { set(path, e.target.value); if (opts.rerender) render(); } });
    for (const o of options) {
      const opt = h('option', { value: o.value }, o.label);
      if (String(get(path)) === String(o.value)) opt.selected = true;
      sel.appendChild(opt);
    }
    return fieldWrap(label, sel, opts.hint);
  }

  function toggle(path, label) {
    const inp = h('input', { type: 'checkbox', onchange: (e) => set(path, e.target.checked) });
    if (get(path)) inp.checked = true;
    return h('div', { class: 'fgroup' },
      h('label', { class: 'switch' }, inp, h('span', { class: 'track' }), h('span', null, label)));
  }

  function range(path, label, min, max, step, unit) {
    const bubble = h('span', { class: 'val' }, get(path) + (unit || ''));
    const inp = h('input', {
      type: 'range', min, max, step, value: get(path),
      oninput: (e) => { const v = parseFloat(e.target.value); set(path, v); bubble.textContent = v + (unit || ''); },
    });
    return fieldWrap(label, h('div', { class: 'rangewrap' }, inp, bubble));
  }

  function colorItem(key, label) {
    const path = 'theme.colors.' + key;
    const hexInput = h('input', {
      type: 'text', value: get(path),
      oninput: (e) => { const v = e.target.value; set(path, v); if (/^#[0-9a-f]{6}$/i.test(v)) picker.value = v; },
    });
    const picker = h('input', {
      type: 'color', value: /^#[0-9a-f]{6}$/i.test(get(path)) ? get(path) : '#000000',
      oninput: (e) => { set(path, e.target.value); hexInput.value = e.target.value; },
    });
    return h('div', { class: 'color-item' }, picker, hexInput, h('span', null, label));
  }

  // ---- section renderers ----
  const SECTIONS = [
    { id: 'branding', label: 'Branding', icon: '🏷️' },
    { id: 'theme', label: 'Theme & Colours', icon: '🎨' },
    { id: 'fonts', label: 'Fonts', icon: '🔤' },
    { id: 'navigation', label: 'Menu', icon: '📑' },
    { id: 'pages', label: 'Pages', icon: '📄' },
    { id: 'announcement', label: 'Announcement', icon: '📢' },
    { id: 'hero', label: 'Hero Banner', icon: '🖼️' },
    { id: 'footer', label: 'Footer', icon: '📎' },
    { id: 'features', label: 'Features', icon: '🧩' },
    { id: 'advanced', label: 'Advanced', icon: '⚙️' },
    { id: 'backup', label: 'Backup', icon: '💾' },
  ];

  const COLOR_LABELS = {
    bg: 'Background', bg2: 'Background 2', panel: 'Panel', panel2: 'Panel 2',
    text: 'Text', muted: 'Muted text', gold: 'Gold', gold2: 'Gold light',
    accent: 'Accent', accent2: 'Accent light', danger: 'Danger', ok: 'Success', border: 'Border',
  };

  const PALETTES = [
    { name: 'Midnight', colors: { bg: '#0f1020', bg2: '#17182e', panel: '#1e1f3a', panel2: '#26274a', text: '#ececff', muted: '#9a9ac2', gold: '#e5b567', gold2: '#f2c987', accent: '#6c5ce7', accent2: '#8b7bf0', danger: '#e0556b', ok: '#4ec98a', border: '#2c2d52' } },
    { name: 'Royal Gold', colors: { bg: '#120f08', bg2: '#1c1710', panel: '#241d12', panel2: '#312716', text: '#f6ecd8', muted: '#bfa982', gold: '#e5b567', gold2: '#ffd68a', accent: '#c9a24b', accent2: '#e5b567', danger: '#e0556b', ok: '#7bbf6a', border: '#3a2f1c' } },
    { name: 'Emerald', colors: { bg: '#07130f', bg2: '#0c1d17', panel: '#10261e', panel2: '#173428', text: '#e6f6ee', muted: '#8fc0ad', gold: '#e5b567', gold2: '#f2c987', accent: '#10b981', accent2: '#34d399', danger: '#e0556b', ok: '#34d399', border: '#1d3a2e' } },
    { name: 'Ocean', colors: { bg: '#08131f', bg2: '#0d1d2e', panel: '#11253a', panel2: '#17324e', text: '#e6f1ff', muted: '#8fb2cf', gold: '#e5b567', gold2: '#f2c987', accent: '#2f80ed', accent2: '#56a0ff', danger: '#e0556b', ok: '#4ec98a', border: '#1d3a52' } },
    { name: 'Rose', colors: { bg: '#1a0d13', bg2: '#26131c', panel: '#301823', panel2: '#40212f', text: '#ffe9f0', muted: '#cf9aae', gold: '#e5b567', gold2: '#f2c987', accent: '#e0417a', accent2: '#f76a9c', danger: '#e0556b', ok: '#4ec98a', border: '#4a2534' } },
    { name: 'Light', mode: 'light', colors: { bg: '#f6f6fb', bg2: '#ececf6', panel: '#ffffff', panel2: '#f0f0f8', text: '#1b1c33', muted: '#61618a', gold: '#c79532', gold2: '#e5b567', accent: '#6c5ce7', accent2: '#8b7bf0', danger: '#d6455f', ok: '#2fa574', border: '#dcdcec' } },
  ];

  function renderBranding() {
    return [
      h('h2', null, 'Branding'),
      h('p', { class: 'desc' }, 'Your site name, logo and login screen.'),
      h('div', { class: 'card' },
        h('div', { class: 'row2' },
          text('branding.siteName', 'Short name (top bar)'),
          text('branding.fullName', 'Full name (page title)')),
        text('branding.tagline', 'Tagline')),
      h('div', { class: 'card' },
        h('h3', null, 'Logo & icon'),
        h('div', { class: 'row2' },
          text('branding.logoEmoji', 'Logo emoji', { hint: 'Used when no logo image is set.' }),
          imageField('branding.logoImage', 'Logo image')),
        imageField('branding.favicon', 'Favicon / browser icon')),
      h('div', { class: 'card' },
        h('h3', null, 'Login screen'),
        h('div', { class: 'row2' },
          text('branding.loginHeading', 'Heading'),
          text('branding.loginSubtext', 'Sub-text'))),
    ];
  }

  function imageField(path, label) {
    const preview = h('div', { style: 'display:flex;align-items:center;gap:10px;margin-top:6px' });
    const draw = () => {
      preview.innerHTML = '';
      const url = get(path);
      if (url) preview.appendChild(h('img', { src: url, style: 'height:40px;border-radius:8px;border:1px solid var(--border)' }));
      preview.appendChild(h('button', { class: 'ghost mini', onclick: () => pickImage((u) => { set(path, u); render(); }) }, url ? 'Replace' : 'Upload'));
      if (url) preview.appendChild(h('button', { class: 'ghost mini danger', onclick: () => { set(path, ''); render(); } }, 'Remove'));
    };
    draw();
    return fieldWrap(label, preview);
  }

  function renderTheme() {
    const swatches = PALETTES.map((p) =>
      h('div', {
        class: 'palette', title: p.name,
        onclick: () => { cfg.theme.colors = { ...p.colors }; if (p.mode) cfg.theme.mode = p.mode; markDirty(); render(); },
      },
        h('div', { class: 'sw' }, ['bg', 'panel', 'accent', 'gold', 'text'].map((k) => h('i', { style: 'background:' + p.colors[k] }))),
        h('div', { class: 'nm' }, p.name)));

    return [
      h('h2', null, 'Theme & Colours'),
      h('p', { class: 'desc' }, 'Pick a palette or fine-tune every colour. Changes apply site-wide on save.'),
      h('div', { class: 'card' },
        h('h3', null, 'Quick palettes'),
        h('div', { class: 'palettes' }, swatches)),
      h('div', { class: 'card' },
        h('h3', null, 'Mode & shape'),
        h('div', { class: 'row2' },
          select('theme.mode', 'Colour mode', [
            { value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }, { value: 'auto', label: 'Auto (follow colours)' }]),
          select('theme.backgroundStyle', 'Background', [
            { value: 'gradient', label: 'Gradient' }, { value: 'solid', label: 'Solid' }])),
        h('div', { class: 'row2' },
          select('theme.density', 'Density', [
            { value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]),
          range('theme.radius', 'Corner radius', 0, 28, 1, 'px'))),
      h('div', { class: 'card' },
        h('h3', null, 'Colours'),
        h('div', { class: 'color-grid' }, Object.entries(COLOR_LABELS).map(([k, l]) => colorItem(k, l)))),
    ];
  }

  function renderFonts() {
    const opts = [{ value: 'system', label: 'System (default)' }]
      .concat(Object.entries(fontPresets).filter(([k]) => k !== 'system').map(([k, v]) => ({ value: k, label: v.label })))
      .concat([{ value: 'custom', label: 'Custom stack…' }]);
    return [
      h('h2', null, 'Fonts'),
      h('p', { class: 'desc' }, 'Choose display and body typefaces. Web fonts load from Google Fonts.'),
      h('div', { class: 'card' },
        h('div', { class: 'row2' },
          select('fonts.heading', 'Heading font', opts, { rerender: true }),
          select('fonts.body', 'Body font', opts, { rerender: true })),
        get('fonts.heading') === 'custom' ? text('fonts.customHeadingStack', 'Custom heading font-family') : null,
        get('fonts.body') === 'custom' ? text('fonts.customBodyStack', 'Custom body font-family') : null),
      h('div', { class: 'card' },
        h('h3', null, 'Sizing'),
        range('fonts.baseSize', 'Base text size', 13, 20, 1, 'px'),
        range('fonts.scale', 'Heading scale', 0.8, 1.6, 0.05, '×')),
    ];
  }

  function renderNavigation() {
    const list = h('div');
    const items = cfg.navigation;

    function redraw() {
      list.innerHTML = '';
      items.forEach((it, idx) => {
        const row = h('div', { class: 'list-item' },
          h('span', { class: 'grab' }, '⋮⋮'),
          h('input', { class: 'li-ico', style: 'width:44px;text-align:center', value: it.icon || '', oninput: (e) => { it.icon = e.target.value; markDirty(); } }),
          h('input', { class: 'li-label', value: it.label || '', oninput: (e) => { it.label = e.target.value; markDirty(); } }),
          h('input', { class: 'li-sec', placeholder: 'Section', value: it.section || '', oninput: (e) => { it.section = e.target.value; markDirty(); } }),
          it.adminOnly ? h('span', { class: 'li-badge' }, 'admin') : null,
          it.href ? h('span', { class: 'li-badge' }, 'link') : null,
          h('label', { class: 'switch', title: 'Visible' },
            (() => { const c = h('input', { type: 'checkbox', onchange: (e) => { it.visible = e.target.checked; markDirty(); } }); if (it.visible) c.checked = true; return c; })(),
            h('span', { class: 'track' })),
          h('div', { class: 'li-btns' },
            h('button', { class: 'ghost mini', title: 'Move up', onclick: () => move(idx, -1) }, '↑'),
            h('button', { class: 'ghost mini', title: 'Move down', onclick: () => move(idx, 1) }, '↓'),
            (it.href || !it.view) ? h('button', { class: 'ghost mini danger', onclick: () => { items.splice(idx, 1); markDirty(); redraw(); } }, '✕') : null));
        list.appendChild(row);
      });
    }
    function move(idx, dir) {
      const j = idx + dir;
      if (j < 0 || j >= items.length) return;
      [items[idx], items[j]] = [items[j], items[idx]];
      markDirty();
      redraw();
    }
    redraw();

    return [
      h('h2', null, 'Menu'),
      h('p', { class: 'desc' }, 'Reorder, rename, group into sections, hide items, or add custom links. Toggle = visible.'),
      h('div', { class: 'card' }, list,
        h('button', {
          class: 'ghost', onclick: () => {
            items.push({ id: 'link-' + Date.now(), label: 'New link', icon: '🔗', href: 'https://', section: 'More', visible: true, adminOnly: false });
            markDirty(); redraw();
          },
        }, '＋ Add custom link')),
      h('p', { class: 'hint2' }, 'Custom links open their URL. Core items navigate inside the app. Set a link’s URL by editing it after adding (via Advanced → export) — or use Pages for rich content.'),
    ];
  }

  function renderPages() {
    const wrap = h('div');
    function list() {
      wrap.innerHTML = '';
      if (!cfg.pages.length) wrap.appendChild(h('p', { class: 'hint2' }, 'No pages yet.'));
      cfg.pages.forEach((p) => {
        wrap.appendChild(h('div', { class: 'list-item' },
          h('span', { class: 'li-ico' }, p.icon || '📄'),
          h('div', { style: 'flex:1' },
            h('b', null, p.title), ' ',
            h('span', { class: 'hint2', style: 'display:inline' }, '/page/' + p.slug + (p.published ? '' : ' · draft'))),
          h('a', { href: '/page/' + p.slug, target: '_blank' }, h('button', { class: 'ghost mini' }, 'View')),
          h('button', { class: 'ghost mini', onclick: () => editPage(p) }, 'Edit'),
          h('button', { class: 'ghost mini danger', onclick: () => delPage(p) }, 'Delete')));
      });
    }
    list();
    return [
      h('h2', null, 'Pages'),
      h('p', { class: 'desc' }, 'Build custom pages (About, Fees, Timetable, Contact…). They can appear in the menu.'),
      h('div', { class: 'card' }, wrap,
        h('button', { class: 'gold', onclick: () => editPage(null) }, '＋ New page')),
    ];
  }

  function editPage(page) {
    const draft = page ? { ...page } : { title: '', icon: '📄', slug: '', body: '', showInNav: true, published: true };
    const body = h('textarea', { style: 'min-height:220px', oninput: (e) => { draft.body = e.target.value; } });
    body.value = draft.body || '';
    const tools = ['h2', 'h3', 'p', 'b', 'i', 'ul', 'li', 'a'];
    const toolbar = h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px' },
      tools.map((t) => h('button', {
        class: 'ghost mini', onclick: () => wrapSel(body, t),
      }, '<' + t + '>')));

    const nav = h('div', { class: 'edit' });
    nav.replaceChildren(
      h('h2', null, page ? 'Edit page' : 'New page'),
      h('p', { class: 'desc' }, 'HTML is allowed in the body.'),
      h('div', { class: 'card' },
        h('div', { class: 'row2' },
          fieldWrap('Title', h('input', { type: 'text', value: draft.title, oninput: (e) => { draft.title = e.target.value; } })),
          fieldWrap('Icon', h('input', { type: 'text', value: draft.icon, oninput: (e) => { draft.icon = e.target.value; } }))),
        fieldWrap('Slug (URL)', h('input', { type: 'text', value: draft.slug, placeholder: 'auto from title', oninput: (e) => { draft.slug = e.target.value; } }), 'Leave blank to auto-generate.'),
        fieldWrap('Body', h('div', null, toolbar, body)),
        h('div', { style: 'display:flex;gap:18px;align-items:center;margin-top:8px' },
          switchInline('Show in menu', draft.showInNav, (v) => { draft.showInNav = v; }),
          switchInline('Published', draft.published, (v) => { draft.published = v; }))),
      h('div', { style: 'display:flex;gap:10px' },
        h('button', { class: 'gold', onclick: () => savePage(draft) }, '💾 Save page'),
        h('button', { class: 'ghost', onclick: () => { active = 'pages'; render(); } }, 'Cancel')));
    $('#edit').replaceChildren(nav);
  }

  function switchInline(label, checked, onchange) {
    const inp = h('input', { type: 'checkbox', onchange: (e) => onchange(e.target.checked) });
    if (checked) inp.checked = true;
    return h('label', { class: 'switch' }, inp, h('span', { class: 'track' }), h('span', null, label));
  }

  function wrapSel(ta, tag) {
    const s = ta.selectionStart, e = ta.selectionEnd;
    const sel = ta.value.slice(s, e) || (tag === 'a' ? 'link text' : tag + ' text');
    const open = tag === 'a' ? '<a href="https://">' : '<' + tag + '>';
    const ins = open + sel + '</' + tag + '>';
    ta.value = ta.value.slice(0, s) + ins + ta.value.slice(e);
    ta.focus();
  }

  async function savePage(draft) {
    try {
      await api('/api/cms/pages', 'POST', draft);
      await reload();
      active = 'pages';
      render();
      toast('Page saved');
    } catch (e) { toast('Save failed: ' + e.message); }
  }
  async function delPage(p) {
    if (!confirm('Delete “' + p.title + '”?')) return;
    await api('/api/cms/pages/' + p.id, 'DELETE');
    await reload();
    render();
    toast('Page deleted');
  }

  function renderAnnouncement() {
    return [
      h('h2', null, 'Announcement bar'),
      h('p', { class: 'desc' }, 'A banner shown across the top of every page.'),
      h('div', { class: 'card' },
        toggle('announcement.enabled', 'Show announcement'),
        text('announcement.text', 'Message'),
        text('announcement.link', 'Link (optional)', { type: 'url', placeholder: 'https://' }),
        h('div', { class: 'row2' },
          select('announcement.style', 'Colour', [
            { value: 'accent', label: 'Accent' }, { value: 'gold', label: 'Gold' }, { value: 'ok', label: 'Green' }, { value: 'danger', label: 'Red' }]),
          h('div', null, toggle('announcement.dismissible', 'Allow dismiss')))),
    ];
  }

  function renderHero() {
    return [
      h('h2', null, 'Hero banner'),
      h('p', { class: 'desc' }, 'A large welcome banner at the top of the Home page.'),
      h('div', { class: 'card' },
        toggle('hero.enabled', 'Show hero'),
        text('hero.title', 'Title'),
        text('hero.subtitle', 'Subtitle'),
        imageField('hero.image', 'Background image'),
        select('hero.align', 'Alignment', [{ value: 'center', label: 'Centre' }, { value: 'left', label: 'Left' }])),
    ];
  }

  function renderFooter() {
    return [
      h('h2', null, 'Footer'),
      h('p', { class: 'desc' }, 'A footer line at the very bottom of every page.'),
      h('div', { class: 'card' }, toggle('footer.enabled', 'Show footer'), text('footer.text', 'Footer text')),
    ];
  }

  function renderFeatures() {
    const labels = { studio: 'Studio / Mixer', practice: 'Practice tools', shares: 'Share links', playlists: 'Playlists', uploads: 'Uploads', downloads: 'Downloads', lyrics: 'Lyrics', radio: 'Radio / autoplay' };
    return [
      h('h2', null, 'Features'),
      h('p', { class: 'desc' }, 'Turn portal features on or off. (Also hide their menu entries under Menu.)'),
      h('div', { class: 'card' }, Object.entries(labels).map(([k, l]) => toggle('features.' + k, l))),
    ];
  }

  function renderAdvanced() {
    return [
      h('h2', null, 'Advanced'),
      h('p', { class: 'desc' }, 'Custom CSS and <head> HTML (e.g. analytics). Applied to every page.'),
      h('div', { class: 'card' }, textarea('advanced.customCss', 'Custom CSS', { rows: 8, placeholder: '.topbar { ... }' })),
      h('div', { class: 'card' }, textarea('advanced.customHeadHtml', 'Custom <head> HTML', { rows: 6, placeholder: '<script>…</script>' })),
    ];
  }

  function renderBackup() {
    return [
      h('h2', null, 'Backup & restore'),
      h('p', { class: 'desc' }, 'Export the whole site configuration to a file, import it elsewhere, or reset.'),
      h('div', { class: 'card' },
        h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap' },
          h('button', { class: 'ghost', onclick: doExport }, '⬇ Export config'),
          h('button', { class: 'ghost', onclick: () => $('#importInput').click() }, '⬆ Import config'),
          h('button', { class: 'danger', onclick: doReset }, 'Reset to defaults'))),
    ];
  }

  const RENDERERS = {
    branding: renderBranding, theme: renderTheme, fonts: renderFonts, navigation: renderNavigation,
    pages: renderPages, announcement: renderAnnouncement, hero: renderHero, footer: renderFooter,
    features: renderFeatures, advanced: renderAdvanced, backup: renderBackup,
  };

  function renderRail() {
    const rail = $('#rail');
    rail.innerHTML = '';
    SECTIONS.forEach((s) => {
      rail.appendChild(h('div', {
        class: 'sec' + (s.id === active ? ' active' : ''),
        onclick: () => { active = s.id; render(); },
      }, h('span', { class: 'i' }, s.icon), s.label));
    });
  }

  function render() {
    renderRail();
    const edit = $('#edit');
    edit.replaceChildren(...(RENDERERS[active]() ));
  }

  // ---- data / api ----
  async function api(url, method, body) {
    const r = await fetch(url, {
      method: method || 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
    return r.json();
  }

  async function reload() {
    const data = await api('/api/cms');
    cfg = data.config;
    fontPresets = data.fontPresets;
    defaults = data.defaults;
  }

  async function save() {
    try {
      await api('/api/cms', 'PUT', cfg);
      dirty = false;
      const s = $('#savedState');
      s.textContent = 'Saved ✓';
      s.classList.remove('dirty');
      refreshPreview();
      toast('Saved — preview updated');
    } catch (e) { toast('Save failed: ' + e.message); }
  }

  async function doReset() {
    if (!confirm('Reset ALL site settings to defaults? This cannot be undone.')) return;
    await api('/api/cms/reset', 'POST');
    await reload();
    render();
    refreshPreview();
    toast('Reset to defaults');
  }

  function doExport() {
    const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: 'gaanasudha-cms.json' });
    a.click();
  }

  // ---- media / import file pickers ----
  let pendingImageCb = null;
  function pickImage(cb) { pendingImageCb = cb; $('#mediaInput').click(); }

  function refreshPreview() {
    const f = $('#preview');
    f.src = '/?t=' + Date.now();
  }

  // ---- boot ----
  async function boot() {
    let user;
    try { user = (await api('/api/me')).user; } catch { user = null; }
    if (!user) { location.href = '/login.html'; return; }
    if (user.role !== 'admin') {
      $('#gateMsg').textContent = 'Admins only';
      $('#gateSub').textContent = 'This area is restricted to administrators.';
      return;
    }
    try { await reload(); } catch (e) {
      $('#gateMsg').textContent = 'Could not load CMS';
      $('#gateSub').textContent = e.message;
      return;
    }
    $('#gate').style.display = 'none';
    $('#cms').style.display = 'grid';

    $('#btnSave').addEventListener('click', save);
    $('#btnReset').addEventListener('click', doReset);
    $('#btnExport').addEventListener('click', doExport);
    $('#btnImport').addEventListener('click', () => $('#importInput').click());
    $('#btnPreview').addEventListener('click', refreshPreview);

    $('#pwDesktop').addEventListener('click', () => setPreviewWidth('desktop'));
    $('#pwMobile').addEventListener('click', () => setPreviewWidth('mobile'));

    $('#mediaInput').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file || !pendingImageCb) return;
      const fd = new FormData();
      fd.append('file', file);
      try {
        const r = await fetch('/api/cms/media', { method: 'POST', body: fd, credentials: 'same-origin' });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'upload failed');
        pendingImageCb(data.url);
        toast('Image uploaded');
      } catch (err) { toast('Upload failed: ' + err.message); }
      pendingImageCb = null;
    });

    $('#importInput').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        cfg = await api('/api/cms/import', 'POST', parsed);
        await reload();
        render();
        refreshPreview();
        toast('Config imported');
      } catch (err) { toast('Import failed: ' + err.message); }
    });

    window.addEventListener('beforeunload', (e) => {
      if (dirty) { e.preventDefault(); e.returnValue = ''; }
    });

    render();
  }

  function setPreviewWidth(mode) {
    const f = $('#preview');
    $('#pwDesktop').classList.toggle('on', mode === 'desktop');
    $('#pwMobile').classList.toggle('on', mode === 'mobile');
    f.style.width = mode === 'mobile' ? '390px' : '100%';
    f.style.height = mode === 'mobile' ? '780px' : '100%';
    f.style.margin = mode === 'mobile' ? '16px auto' : '0';
    f.style.border = mode === 'mobile' ? '1px solid var(--border)' : '0';
    f.style.borderRadius = mode === 'mobile' ? '18px' : '0';
  }

  boot();
})();
