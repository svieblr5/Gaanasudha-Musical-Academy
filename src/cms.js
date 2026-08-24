// ===========================================================================
// CMS — site configuration store (branding, theme, fonts, navigation, pages,
// announcements, hero, footer, feature toggles, custom CSS/JS).
//
// The whole site is themeable/editable from the admin CMS without touching
// code: the config here drives /cms/theme.css (live CSS variables + fonts) and
// /api/cms/config (consumed by cms-client.js on every page).
// ===========================================================================
import crypto from 'node:crypto';
import { readJson, writeJson } from './store.js';

const FILE = 'cms.json';

// --- Defaults mirror the shipped look so an un-customised site is unchanged ---
export const DEFAULTS = {
  branding: {
    siteName: 'Gaanasudha',
    fullName: 'Gaanasudha Musical Academy',
    tagline: 'Your music, front and centre.',
    logoEmoji: '🎼',
    logoImage: '',          // uploaded image URL overrides the emoji when set
    favicon: '',            // uploaded favicon URL; blank = default music emoji
    loginHeading: 'Gaanasudha Musical Academy',
    loginSubtext: 'Private music library',
  },
  theme: {
    mode: 'dark',           // 'dark' | 'light' | 'auto'
    colors: {
      bg: '#0f1020',
      bg2: '#17182e',
      panel: '#1e1f3a',
      panel2: '#26274a',
      text: '#ececff',
      muted: '#9a9ac2',
      gold: '#e5b567',
      gold2: '#f2c987',
      accent: '#6c5ce7',
      accent2: '#8b7bf0',
      danger: '#e0556b',
      ok: '#4ec98a',
      border: '#2c2d52',
    },
    radius: 12,             // px
    density: 'comfortable', // 'comfortable' | 'compact'
    backgroundStyle: 'gradient', // 'gradient' | 'solid'
  },
  fonts: {
    body: 'system',         // key from FONT_PRESETS or 'system'/'custom'
    heading: 'system',
    baseSize: 16,           // px
    scale: 1.0,             // heading scale multiplier
    customBodyStack: '',    // used when body === 'custom'
    customHeadingStack: '',
  },
  navigation: [
    { id: 'home', label: 'Home', icon: '🏠', view: 'home', section: '', visible: true, adminOnly: false },
    { id: 'library', label: 'All Songs', icon: '🎵', view: 'library', section: 'Browse', visible: true, adminOnly: false },
    { id: 'albums', label: 'Albums', icon: '💿', view: 'albums', section: '', visible: true, adminOnly: false },
    { id: 'artists', label: 'Artists', icon: '🎤', view: 'artists', section: '', visible: true, adminOnly: false },
    { id: 'genres', label: 'Genres', icon: '🎧', view: 'genres', section: '', visible: true, adminOnly: false },
    { id: 'favorites', label: 'Favorites', icon: '❤️', view: 'favorites', section: 'Your Music', visible: true, adminOnly: false },
    { id: 'recent', label: 'Recently Played', icon: '🕒', view: 'recent', section: '', visible: true, adminOnly: false },
    { id: 'top', label: 'Most Played', icon: '🔥', view: 'top', section: '', visible: true, adminOnly: false },
    { id: 'playlists', label: 'Playlists', icon: '📃', view: 'playlists', section: '', visible: true, adminOnly: false },
    { id: 'shares', label: 'Share Links', icon: '🔗', view: 'shares', section: '', visible: true, adminOnly: false },
    { id: 'practice', label: 'Tanpura & Tala', icon: '🎼', view: 'practice', section: 'Practice', visible: true, adminOnly: false },
    { id: 'practice-share', label: 'Share / QR', icon: '📲', view: 'practice-share', section: '', visible: true, adminOnly: false },
    { id: 'studio', label: 'Studio / Mixer', icon: '🎚️', view: 'studio', section: 'Studio', visible: true, adminOnly: false },
    { id: 'account', label: 'My Account', icon: '👤', view: 'account', section: 'Account', visible: true, adminOnly: false },
    { id: 'upload', label: 'Upload Music', icon: '⬆️', view: 'upload', section: 'Administration', visible: true, adminOnly: true },
    { id: 'users', label: 'Users', icon: '👥', view: 'users', section: '', visible: true, adminOnly: true },
    { id: 'cms', label: 'Site Builder', icon: '🎨', view: 'cms', section: '', visible: true, adminOnly: true, href: '/admin.html' },
  ],
  announcement: {
    enabled: false,
    text: '🎉 Welcome to the new Gaanasudha portal!',
    link: '',
    style: 'accent',        // 'accent' | 'gold' | 'ok' | 'danger'
    dismissible: true,
  },
  hero: {
    enabled: false,
    title: 'Welcome to Gaanasudha',
    subtitle: 'Stream lessons, recitals and practice tracks.',
    image: '',
    align: 'center',        // 'left' | 'center'
  },
  footer: {
    enabled: false,
    text: '© Gaanasudha Musical Academy',
  },
  pages: [
    // { id, slug, title, icon, body(HTML), showInNav, published }
  ],
  features: {
    studio: true,
    practice: true,
    shares: true,
    playlists: true,
    uploads: true,
    downloads: true,
    lyrics: true,
    radio: true,
  },
  advanced: {
    customCss: '',
    customHeadHtml: '',     // e.g. analytics snippet (injected in <head>)
  },
  updatedAt: null,
};

// A curated set of Google Fonts offered in the CMS font picker. `stack` is the
// CSS font-family; `google` is the family name to load from Google Fonts.
export const FONT_PRESETS = {
  system: { label: 'System (default)', stack: '"Segoe UI", system-ui, -apple-system, sans-serif', google: null },
  inter: { label: 'Inter', stack: "'Inter', system-ui, sans-serif", google: 'Inter:wght@400;500;600;700' },
  poppins: { label: 'Poppins', stack: "'Poppins', system-ui, sans-serif", google: 'Poppins:wght@400;500;600;700' },
  montserrat: { label: 'Montserrat', stack: "'Montserrat', system-ui, sans-serif", google: 'Montserrat:wght@400;500;600;700' },
  nunito: { label: 'Nunito', stack: "'Nunito', system-ui, sans-serif", google: 'Nunito:wght@400;600;700;800' },
  rubik: { label: 'Rubik', stack: "'Rubik', system-ui, sans-serif", google: 'Rubik:wght@400;500;600;700' },
  quicksand: { label: 'Quicksand', stack: "'Quicksand', system-ui, sans-serif", google: 'Quicksand:wght@400;500;600;700' },
  raleway: { label: 'Raleway', stack: "'Raleway', system-ui, sans-serif", google: 'Raleway:wght@400;500;600;700' },
  playfair: { label: 'Playfair Display', stack: "'Playfair Display', Georgia, serif", google: 'Playfair+Display:wght@400;500;600;700' },
  merriweather: { label: 'Merriweather', stack: "'Merriweather', Georgia, serif", google: 'Merriweather:wght@400;700' },
  lora: { label: 'Lora', stack: "'Lora', Georgia, serif", google: 'Lora:wght@400;500;600;700' },
  cormorant: { label: 'Cormorant Garamond', stack: "'Cormorant Garamond', Georgia, serif", google: 'Cormorant+Garamond:wght@400;500;600;700' },
  spacegrotesk: { label: 'Space Grotesk', stack: "'Space Grotesk', system-ui, sans-serif", google: 'Space+Grotesk:wght@400;500;600;700' },
  sora: { label: 'Sora', stack: "'Sora', system-ui, sans-serif", google: 'Sora:wght@400;500;600;700' },
  yatra: { label: 'Yatra One (Indic display)', stack: "'Yatra One', system-ui, cursive", google: 'Yatra+One' },
  tiro: { label: 'Tiro Devanagari', stack: "'Tiro Devanagari Hindi', serif", google: 'Tiro+Devanagari+Hindi' },
};

// Recursively merge a partial patch onto a base object (arrays are replaced,
// not merged, so navigation/pages fully reflect what the editor sends).
function deepMerge(base, patch) {
  if (Array.isArray(base) || Array.isArray(patch)) {
    return patch === undefined ? base : patch;
  }
  if (base && typeof base === 'object' && patch && typeof patch === 'object') {
    const out = { ...base };
    for (const k of Object.keys(patch)) out[k] = deepMerge(base[k], patch[k]);
    return out;
  }
  return patch === undefined ? base : patch;
}

// Full config = defaults with the saved overrides layered on top, so new
// default keys added in future releases appear automatically.
export function getConfig() {
  const saved = readJson(FILE, {});
  return deepMerge(DEFAULTS, saved);
}

export function saveConfig(patch) {
  const next = deepMerge(getConfig(), patch || {});
  next.updatedAt = new Date().toISOString();
  writeJson(FILE, next);
  return next;
}

export function replaceConfig(full) {
  const next = deepMerge(DEFAULTS, full || {});
  next.updatedAt = new Date().toISOString();
  writeJson(FILE, next);
  return next;
}

export function reset() {
  const next = { ...DEFAULTS, updatedAt: new Date().toISOString() };
  writeJson(FILE, next);
  return next;
}

// --- Pages helpers ---
function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'page';
}

export function upsertPage(page) {
  const cfg = getConfig();
  const pages = [...cfg.pages];
  let slug = page.slug ? slugify(page.slug) : slugify(page.title);
  const record = {
    id: page.id || crypto.randomUUID(),
    slug,
    title: page.title || 'Untitled',
    icon: page.icon || '📄',
    body: page.body || '',
    showInNav: page.showInNav !== false,
    published: page.published !== false,
    updatedAt: new Date().toISOString(),
  };
  const idx = pages.findIndex((p) => p.id === record.id);
  // Ensure slug uniqueness (append -2, -3… on collision with a different page).
  let n = 2;
  while (pages.some((p) => p.slug === record.slug && p.id !== record.id)) {
    record.slug = `${slug}-${n++}`;
  }
  if (idx >= 0) pages[idx] = { ...pages[idx], ...record };
  else pages.push(record);
  saveConfig({ pages });
  return record;
}

export function deletePage(id) {
  const cfg = getConfig();
  const pages = cfg.pages.filter((p) => p.id !== id);
  if (pages.length === cfg.pages.length) return false;
  saveConfig({ pages });
  return true;
}

export function getPage(slug) {
  return getConfig().pages.find((p) => p.slug === slug) || null;
}

// The font stack + Google font family for a given font key.
export function resolveFont(key, customStack) {
  if (key === 'custom' && customStack) return { stack: customStack, google: null };
  const preset = FONT_PRESETS[key] || FONT_PRESETS.system;
  return { stack: preset.stack, google: preset.google };
}

// Light-mode colour overrides applied when theme.mode === 'light'. Only the
// structural colours flip; brand accents (gold/accent) carry over.
const LIGHT = {
  bg: '#f6f6fb', bg2: '#ececf6', panel: '#ffffff', panel2: '#f0f0f8',
  text: '#1b1c33', muted: '#61618a', border: '#dcdcec',
};

function esc(s) {
  return String(s == null ? '' : s).replace(/[<>]/g, '');
}

// Build the live stylesheet served at /cms/theme.css. It redefines the CSS
// variables from style.css, sets fonts, and appends any custom CSS. Loaded
// after style.css on every page so it wins the cascade.
export function buildThemeCss(cfg) {
  const c = { ...cfg.theme.colors };
  if (cfg.theme.mode === 'light') Object.assign(c, LIGHT);

  const body = resolveFont(cfg.fonts.body, cfg.fonts.customBodyStack);
  const heading = resolveFont(cfg.fonts.heading, cfg.fonts.customHeadingStack);
  const googleFamilies = [body.google, heading.google].filter(Boolean);
  const importLine = googleFamilies.length
    ? `@import url('https://fonts.googleapis.com/css2?${googleFamilies.map((f) => `family=${f}`).join('&')}&display=swap');\n`
    : '';

  const baseSize = Number(cfg.fonts.baseSize) || 16;
  const scale = Number(cfg.fonts.scale) || 1;
  const radius = Number(cfg.theme.radius);
  const bgDecl = cfg.theme.backgroundStyle === 'solid'
    ? `background: ${c.bg};`
    : `background: linear-gradient(160deg, ${c.bg}, ${c.bg2});`;
  const density = cfg.theme.density === 'compact' ? '0.82' : '1';

  return `${importLine}:root {
  --bg: ${c.bg};
  --bg-2: ${c.bg2};
  --panel: ${c.panel};
  --panel-2: ${c.panel2};
  --text: ${c.text};
  --muted: ${c.muted};
  --gold: ${c.gold};
  --gold-2: ${c.gold2};
  --accent: ${c.accent};
  --accent-2: ${c.accent2};
  --danger: ${c.danger};
  --ok: ${c.ok};
  --border: ${c.border};
  --radius: ${Number.isFinite(radius) ? radius : 12}px;
  --cms-density: ${density};
}
html { font-size: ${baseSize}px; }
body { font-family: ${body.stack}; ${bgDecl} }
h1, h2, h3, .brand .title, .brand h1 { font-family: ${heading.stack}; }
h1 { font-size: calc(1.8rem * ${scale}); }
h2 { font-size: calc(1.4rem * ${scale}); }
${cfg.advanced.customCss || ''}
`;
}

// Small JSON payload consumed by cms-client.js on every page to apply branding,
// render the announcement banner, footer, and inject the font <link>.
export function clientConfig(cfg) {
  const body = resolveFont(cfg.fonts.body, cfg.fonts.customBodyStack);
  const heading = resolveFont(cfg.fonts.heading, cfg.fonts.customHeadingStack);
  return {
    branding: cfg.branding,
    announcement: cfg.announcement,
    hero: cfg.hero,
    footer: cfg.footer,
    navigation: cfg.navigation,
    features: cfg.features,
    pages: cfg.pages
      .filter((p) => p.published)
      .map((p) => ({ id: p.id, slug: p.slug, title: p.title, icon: p.icon, showInNav: p.showInNav })),
    googleFonts: [body.google, heading.google].filter(Boolean),
    customHeadHtml: cfg.advanced.customHeadHtml || '',
    updatedAt: cfg.updatedAt,
  };
}

