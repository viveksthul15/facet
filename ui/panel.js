const api = window.facet;

const state = {
  view: 'populated',
  profiles: [],
  running: new Set(),
  claudeExe: null,
  claudeExeSource: null,
  adoptable: false,
  paths: { root: '', claudeData: '' },
  settings: {},
  lockedSettings: [],
  portable: false,
  add: { name: '', color: 'indigo', error: '', preflight: null },
  orphans: [],
  orphanCount: 0,
  adopt: { name: 'Personal', color: 'emerald', error: '' },
  rename: { id: null, value: '' },
  hotkeyRecording: false,
  confirm: null,
  onboarding: false,
};

const COLORS = ['indigo', 'emerald', 'amber', 'rose', 'violet', 'sky'];

// ================= tiny dom helper =================
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [prop, val] of Object.entries(v)) {
        if (prop.startsWith('--')) n.style.setProperty(prop, val);
        else n.style[prop] = val;
      }
    }
    else if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') n.innerHTML = v;
    else if (v === true) n.setAttribute(k, '');
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  for (const k of kids.flat()) {
    if (k == null || k === false) continue;
    n.appendChild(k.nodeType ? k : document.createTextNode(String(k)));
  }
  return n;
};

const svg = (paths, size = 14) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 16 16');
  s.setAttribute('width', size);
  s.setAttribute('height', size);
  for (const d of paths) {
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d);
    s.appendChild(p);
  }
  return s;
};

const ICONS = {
  gear: () => svg(['M8 1v2', 'M8 13v2', 'M15 8h-2', 'M3 8H1', 'M12.95 3.05l-1.4 1.4', 'M4.45 11.55l-1.4 1.4', 'M12.95 12.95l-1.4-1.4', 'M4.45 4.45L3.05 3.05', 'M10 8a2 2 0 11-4 0 2 2 0 014 0z']),
  close: () => svg(['M4 4l8 8', 'M12 4l-8 8']),
  plus: () => svg(['M8 3v10', 'M3 8h10']),
  menu: () => svg(['M2.5 4h11', 'M2.5 8h11', 'M2.5 12h11']),
  back: () => svg(['M10 4l-4 4 4 4']),
  check: () => svg(['M3 8l3 3 7-7']),
  pencil: () => svg(['M3 13l2-1 7-7-1-1-7 7-1 2z', 'M10 4l2 2']),
  trash: () => svg(['M4 5h8', 'M6 5V3h4v2', 'M5 5l1 8h4l1-8']),
  arrowRight: () => svg(['M4 8h8', 'M9 5l3 3-3 3']),
  arrowUp: () => svg(['M8 12V4', 'M4 8l4-4 4 4']),
  arrowDown: () => svg(['M8 4v8', 'M4 8l4 4 4-4']),
  folder: () => svg(['M2 4h4l2 2h6v7H2z']),
  warn: () => svg(['M8 2l7 12H1L8 2z', 'M8 6v4', 'M8 12h.01']),
  copy: () => svg(['M5 5V3h8v8h-2', 'M3 5h8v8H3z']),
  download: () => svg(['M8 2v9', 'M4 7l4 4 4-4', 'M3 14h10']),
  upload: () => svg(['M8 11V2', 'M4 6l4-4 4 4', 'M3 14h10']),
  lock: () => svg(['M4 8h8v6H4z', 'M6 8V5a2 2 0 014 0v3']),
};

const brandMark = () => el('span', { class: 'brand-mark', 'aria-hidden': 'true' },
  el('i'), el('i'), el('i'));

const laneVar = (color) => `--lane-color: var(--lane-${color || 'indigo'});`;

function shortSub(p) {
  if (p.adopted) return `%APPDATA%\\Claude · adopted`;
  return `claude-${p.slug}`;
}

// ================= views =================

function viewPopulated() {
  const runningCount = state.profiles.filter(p => state.running.has(p.id)).length;
  return el('div', { class: 'panel' },
    el('div', { class: 'panel-head' },
      el('div', { class: 'panel-title' },
        brandMark(), 'Facet',
        runningCount > 0 && el('span', { class: 'running' },
          el('span', { class: 'dot' }), `${runningCount} running`),
      ),
      el('div', { class: 'panel-head-tools' },
        el('button', { class: 'icon-btn', title: 'Settings',
          onclick: () => setView('settings') }, ICONS.gear()),
        el('button', { class: 'icon-btn', title: 'Open data folder',
          onclick: () => api.openPath(state.paths.root) }, ICONS.folder()),
        el('button', { class: 'icon-btn', title: 'Close (Esc)',
          onclick: () => api.hide() }, ICONS.close()),
      ),
    ),
    el('div', { class: 'panel-eyebrow' },
      el('span', {}, 'Profiles'),
      el('span', { class: 'count' }, String(state.profiles.length)),
    ),
    !state.claudeExe && el('div', { class: 'error-strip' },
      el('b', {}, 'Claude Desktop not found. '),
      'Install from claude.ai/download, or ',
      el('a', { href: '#', onclick: (e) => { e.preventDefault(); setView('settings'); },
        style: { color: 'var(--danger)', textDecoration: 'underline', cursor: 'pointer' } },
        'set the path manually'),
      '.',
    ),
    state.adoptable && renderAdoptBanner(),
    el('div', { class: 'lane-list', role: 'listbox' },
      ...state.profiles.map((p, i) => renderLaneRow(p, i)),
    ),
    el('div', { class: 'divider' }),
    el('div', { class: 'panel-foot' },
      el('button', { class: 'foot-btn', onclick: () => setView('add') },
        ICONS.plus(), 'Add profile'),
      el('button', { class: 'foot-btn', onclick: () => setView('manage') },
        ICONS.menu(), 'Manage'),
    ),
  );
}

function renderLaneRow(p, i) {
  const isRenaming = state.rename.id === p.id;
  return el('div', {
    class: 'lane', style: laneVar(p.color), role: 'option', tabindex: '0',
    onclick: () => !isRenaming && onLaunch(p),
    onkeydown: (e) => {
      if (isRenaming) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onLaunch(p); }
      if (e.key === 'F2') { e.preventDefault(); beginRename(p); }
    },
    oncontextmenu: (e) => { e.preventDefault(); api.contextMenu({ id: p.id }); },
  },
    el('span', { class: 'bar' }),
    el('div', { class: 'lane-body' },
      isRenaming
        ? el('input', {
            class: 'inline-rename', type: 'text', value: state.rename.value, autofocus: true,
            oninput: (e) => { state.rename.value = e.target.value; },
            onkeydown: (e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitRename(p); }
              if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
            },
            onblur: () => commitRename(p),
            onclick: (e) => e.stopPropagation(),
          })
        : el('div', { class: 'name' }, p.name,
            state.running.has(p.id) && el('span', { class: 'status-dot', 'aria-label': 'running' }),
            p.adopted && el('span', { class: 'badge-adopted', title: 'Adopted from an existing Claude session' }, 'Adopted'),
          ),
      !isRenaming && el('div', { class: 'sub' }, shortSub(p)),
    ),
    el('div', { class: 'lane-tail' },
      !isRenaming && i < 9 && el('span', { class: 'kbd' }, `Alt ${i + 1}`),
    ),
  );
}

function viewEmpty() {
  return el('div', { class: 'panel' },
    el('div', { class: 'panel-head' },
      el('div', { class: 'panel-title' }, brandMark(), 'Facet'),
      el('div', { class: 'panel-head-tools' },
        el('button', { class: 'icon-btn', title: 'Settings',
          onclick: () => setView('settings') }, ICONS.gear()),
        el('button', { class: 'icon-btn', onclick: () => api.hide() }, ICONS.close()),
      ),
    ),
    !state.claudeExe && el('div', { class: 'error-strip' },
      el('b', {}, 'Claude Desktop not found. '),
      'Install from claude.ai/download, or ',
      el('a', { href: '#', onclick: (e) => { e.preventDefault(); setView('settings'); },
        style: { color: 'var(--danger)', textDecoration: 'underline', cursor: 'pointer' } },
        'set the path manually'),
      '.',
    ),
    el('div', { class: 'empty' },
      el('div', { class: 'empty-hero' }, el('i'), el('i'), el('i')),
      el('h3', {}, 'No profiles yet'),
      el('p', {}, 'Each profile runs Claude Desktop against its own data directory. Sign in once per profile — sessions stay put.'),
    ),
    state.adoptable && renderAdoptBanner(),
    el('div', { class: 'empty' },
      el('div', { class: 'empty-actions' },
        el('button', { class: 'btn-primary', onclick: () => setView('add') },
          ICONS.plus(), 'Create a new profile'),
      ),
    ),
  );
}

function renderAdoptBanner() {
  return el('div', { class: 'adopt-banner' },
    el('div', { class: 'adopt-head' }, el('span', { class: 'accent-dot' }), 'Existing Claude session detected'),
    el('p', {}, 'Adopt your signed-in session as a profile — no re-login. Tag it however you like.'),
    el('div', { class: 'adopt-form' },
      el('div', { class: 'input-wrap adopt-input' },
        el('input', { id: 'adopt-name', type: 'text', value: state.adopt.name, spellcheck: 'false',
          placeholder: 'e.g. Personal, Office, Client…',
          oninput: (e) => { state.adopt.name = e.target.value; state.adopt.error = ''; },
          onkeydown: (e) => { if (e.key === 'Enter') onAdopt(); },
        }),
      ),
      el('div', { class: 'color-picker', role: 'radiogroup' },
        ...COLORS.map(c => el('span', {
          class: `swatch ${state.adopt.color === c ? 'is-checked' : ''}`,
          style: { '--sw': `var(--lane-${c})` },
          role: 'radio', 'aria-checked': state.adopt.color === c ? 'true' : 'false', tabindex: '0',
          onclick: () => { state.adopt.color = c; render(); },
        })),
      ),
    ),
    state.adopt.error && el('div', { class: 'error' }, state.adopt.error),
    el('div', { class: 'adopt-actions' },
      el('button', { class: 'btn-mini primary', onclick: onAdopt }, 'Adopt without re-login'),
      el('button', { class: 'btn-mini ghost', onclick: () => { state.adoptable = false; render(); } }, 'Skip'),
    ),
  );
}

function viewAdd() {
  const claudeOK = !!state.claudeExe;
  const slug = slugify(state.add.name || '');
  const previewPath = `${state.paths.root}\\profiles\\${slug || '…'}`;
  const pre = state.add.preflight;
  return el('div', { class: 'panel' },
    el('div', { class: 'panel-head' },
      el('div', { class: 'panel-title' }, brandMark(), 'Add profile'),
      el('div', { class: 'panel-head-tools' },
        el('button', { class: 'icon-btn', onclick: () => setView(state.profiles.length ? 'populated' : 'empty') }, ICONS.back()),
      ),
    ),
    el('div', { class: 'form' },
      // Prominent nudge if there's still a signed-in Claude session and no adopted profile
      state.adoptable && el('div', { class: 'adopt-inline' },
        el('div', { class: 'adopt-inline-body' },
          el('span', { class: 'accent-dot' }),
          el('div', {},
            el('div', { class: 'adopt-inline-head' }, 'Existing Claude session detected'),
            el('div', { class: 'adopt-inline-sub' },
              'Creating a new profile signs you out. To keep your current account, ',
              el('a', { href: '#', onclick: (e) => { e.preventDefault(); setView(state.profiles.length ? 'populated' : 'empty'); },
                style: { color: 'var(--accent)', textDecoration: 'underline', cursor: 'pointer' } },
                'adopt it instead'),
              '.',
            ),
          ),
        ),
      ),
      el('div', { class: 'field' },
        el('label', {}, 'App'),
        el('div', { class: 'app-picker' },
          el('div', { class: 'app-opt is-checked' },
            el('span', { class: 'app-icon' }, 'C'),
            el('div', { class: 'app-body' },
              el('span', { class: 'app-name' }, 'Claude Desktop'),
              el('span', { class: 'app-sub' }, 'Electron · honors --user-data-dir'),
            ),
            el('span', { class: `app-tag ${claudeOK ? '' : 'warn'}` }, claudeOK ? 'Detected' : 'Not found'),
          ),
        ),
      ),
      el('div', { class: 'field' },
        el('label', { for: 'profile-name' }, 'Profile name'),
        el('div', { class: 'input-wrap' },
          el('input', { id: 'profile-name', type: 'text', value: state.add.name, spellcheck: 'false',
            placeholder: 'e.g. Client — Novacore',
            oninput: (e) => { state.add.name = e.target.value; state.add.error = ''; runPreflight(); renderInline(); },
            onkeydown: (e) => { if (e.key === 'Enter') onCreate(); },
          }),
        ),
        el('div', { class: 'hint' }, 'Data directory: ', el('b', {}, previewPath)),
        // Preflight surfaces — duplicate-name error, or orphan-data warning with choose-your-own actions
        pre && pre.reason === 'duplicate-name' && el('div', { class: 'error' },
          'A profile with that name already exists. Pick a different name.'),
        pre && pre.warn === 'orphan-exists' && el('div', { class: 'preflight-warn' },
          el('div', { class: 'preflight-head' }, ICONS.warn(),
            pre.hasSession
              ? el('span', {}, el('b', {}, 'Existing session data at this slug. '),
                  'Reusing it will bring back that account, not create a fresh signed-out one.')
              : el('span', {}, el('b', {}, 'Old data folder for this slug exists. '),
                  'It has no session state — safe to reuse or wipe.')),
          el('div', { class: 'preflight-actions' },
            el('button', { class: 'btn-mini ghost', onclick: () => onCreateWith('recover') }, 'Reuse existing data'),
            el('button', { class: 'btn-mini destroy', onclick: () => onCreateWith('wipe') }, 'Wipe & start fresh'),
          ),
        ),
        state.add.error && el('div', { class: 'error' }, state.add.error),
      ),
      el('div', { class: 'field' },
        el('label', {}, 'Accent'),
        el('div', { class: 'color-picker', role: 'radiogroup', 'aria-label': 'Accent color' },
          ...COLORS.map(c => el('span', {
            class: `swatch ${state.add.color === c ? 'is-checked' : ''}`,
            style: { '--sw': `var(--lane-${c})` },
            role: 'radio', 'aria-checked': state.add.color === c ? 'true' : 'false', tabindex: '0',
            onclick: () => { state.add.color = c; render(); },
          })),
        ),
      ),
      el('div', { class: 'form-foot' },
        el('button', { class: 'btn-secondary', onclick: () => setView(state.profiles.length ? 'populated' : 'empty') }, 'Cancel'),
        el('button', {
          class: 'btn-primary',
          disabled: !state.add.name.trim() || !claudeOK
            || (pre && (pre.reason === 'duplicate-name' || pre.warn === 'orphan-exists')),
          onclick: onCreate,
        }, 'Create & launch', ICONS.arrowRight()),
      ),
    ),
  );
}

function viewManage() {
  return el('div', { class: 'panel' },
    el('div', { class: 'panel-head' },
      el('div', { class: 'panel-title' }, brandMark(), 'Manage'),
      el('div', { class: 'panel-head-tools' },
        el('button', { class: 'icon-btn', onclick: () => setView('populated') }, ICONS.check()),
      ),
    ),
    el('div', { class: 'panel-eyebrow' },
      el('span', {}, 'Profiles'),
      el('span', { class: 'count' }, String(state.profiles.length)),
    ),
    el('div', { class: 'manage-list' },
      ...state.profiles.map((p, i) => renderManageRow(p, i)),
      state.profiles.length === 0 && el('div', {
        style: { padding: '18px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' },
      }, 'No profiles to manage.'),
    ),
    el('div', { class: 'warn-strip' },
      el('span', { class: 'warn-icon' }, ICONS.warn()),
      el('div', { html: 'Removing a Facet-created profile offers to delete its data folder. Removing an <b>adopted</b> profile only drops it from Facet — your real <code>%APPDATA%\\Claude</code> data stays untouched.' }),
    ),
  );
}

function renderManageRow(p, i) {
  const isRenaming = state.rename.id === p.id;
  const showColorPicker = state.rename.showColorFor === p.id;
  return el('div', { class: 'manage-row', style: laneVar(p.color) },
    el('span', { class: 'bar' }),
    el('div', { class: 'm-body' },
      isRenaming
        ? el('input', {
            class: 'inline-rename', type: 'text', value: state.rename.value, autofocus: true,
            oninput: (e) => { state.rename.value = e.target.value; },
            onkeydown: (e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitRename(p); }
              if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
            },
            onblur: () => commitRename(p),
          })
        : el('div', { class: 'm-name' }, p.name,
            p.adopted && el('span', { class: 'adopted-chip' }, 'Adopted'),
          ),
      el('div', { class: 'm-path' },
        p.adopted ? `${state.paths.claudeData} · in place`
                 : `${state.paths.root}\\profiles\\claude-${p.slug}`),
      showColorPicker && el('div', { class: 'color-picker manage-colors', role: 'radiogroup' },
        ...COLORS.map(c => el('span', {
          class: `swatch ${p.color === c ? 'is-checked' : ''}`,
          style: { '--sw': `var(--lane-${c})` },
          role: 'radio', 'aria-checked': p.color === c ? 'true' : 'false', tabindex: '0',
          onclick: async () => {
            await api.setColor({ id: p.id, color: c });
            state.rename.showColorFor = null;
            await refresh(); render();
          },
        })),
      ),
    ),
    el('div', { class: 'm-actions' },
      el('button', { class: 'icon-btn', title: 'Move up', disabled: i === 0,
        onclick: () => onReorder(p, 'up') }, ICONS.arrowUp()),
      el('button', { class: 'icon-btn', title: 'Move down', disabled: i === state.profiles.length - 1,
        onclick: () => onReorder(p, 'down') }, ICONS.arrowDown()),
      el('button', { class: 'icon-btn', title: 'Change color',
        onclick: () => { state.rename.showColorFor = showColorPicker ? null : p.id; render(); } },
        el('span', { class: 'color-dot', style: { background: `var(--lane-${p.color || 'indigo'})` } })),
      el('button', { class: 'icon-btn', title: 'Rename (F2)', onclick: () => beginRename(p) }, ICONS.pencil()),
      el('button', { class: 'icon-btn', title: 'Duplicate', onclick: () => onDuplicate(p) }, ICONS.copy()),
      el('button', { class: 'icon-btn danger', title: 'Remove', onclick: () => askRemove(p) }, ICONS.trash()),
    ),
  );
}

function viewSettings() {
  const isLocked = (k) => state.lockedSettings.includes(k);
  const sourceLabel = ({
    custom: 'Custom path',
    installer: 'Traditional installer',
    msix: 'Microsoft Store (MSIX)',
  })[state.claudeExeSource] || 'Not detected';

  return el('div', { class: 'panel' },
    el('div', { class: 'panel-head' },
      el('div', { class: 'panel-title' }, brandMark(), 'Settings'),
      el('div', { class: 'panel-head-tools' },
        el('button', { class: 'icon-btn', title: 'Done',
          onclick: () => setView(state.profiles.length ? 'populated' : 'empty') }, ICONS.check()),
      ),
    ),
    el('div', { class: 'form settings' },
      renderSettingsSection('Claude Desktop', [
        el('div', { class: 'settings-current' },
          el('div', { class: 'settings-source' },
            el('span', { class: `source-pill source-${state.claudeExeSource || 'none'}` }, sourceLabel),
            state.settings.customClaudePath && !isLocked('customClaudePath') && el('button', { class: 'link-btn', onclick: onResetCustomPath }, 'Reset to auto-detect'),
          ),
          el('div', { class: 'settings-path' },
            state.claudeExe || el('span', { style: { color: 'var(--danger)' } }, 'No executable found')),
        ),
        el('div', { class: 'settings-actions' },
          el('button', {
            class: 'btn-primary', disabled: isLocked('customClaudePath'),
            onclick: onPickClaudeExe,
          }, ICONS.folder(), state.settings.customClaudePath ? 'Change custom path…' : 'Set custom path…'),
        ),
        isLocked('customClaudePath') && lockNotice(),
      ]),
      renderSettingsSection('Startup', [
        renderToggle('Launch Facet at Windows sign-in',
          'launchAtLogin', state.settings.launchAtLogin, isLocked('launchAtLogin')),
      ]),
      renderSettingsSection('Global shortcut', [
        el('div', { class: 'settings-hotkey' },
          el('div', { class: 'hotkey-display' },
            (state.settings.globalHotkey || '—').split('+').map((k, i, arr) =>
              [el('span', { class: 'kbd' }, k), i < arr.length - 1 && el('span', { class: 'kbd-plus' }, '+')]).flat()),
          el('div', { class: 'settings-actions' },
            state.hotkeyRecording
              ? el('button', { class: 'btn-secondary', onclick: () => { state.hotkeyRecording = false; render(); } }, 'Cancel')
              : el('button', { class: 'btn-secondary', disabled: isLocked('globalHotkey'),
                  onclick: () => { state.hotkeyRecording = true; render(); } }, 'Change…'),
          ),
        ),
        state.hotkeyRecording && el('div', { class: 'hotkey-recorder', tabindex: '0', autofocus: true,
          onkeydown: onRecordHotkey,
        }, 'Press a shortcut… (Ctrl/Alt/Shift/Win + a key). Esc to cancel.'),
        el('div', { class: 'hint' }, 'Press this from anywhere to open the Facet panel.'),
        isLocked('globalHotkey') && lockNotice(),
      ]),
      renderSettingsSection('Behavior', [
        renderToggle('Confirm on quit if profiles are running',
          'confirmOnQuit', state.settings.confirmOnQuit, isLocked('confirmOnQuit')),
      ]),
      renderSettingsSection('Data & profiles', [
        el('div', { class: 'settings-current' },
          el('div', { class: 'settings-path' }, state.paths.root),
          state.portable && el('div', { class: 'hint' }, el('b', {}, 'Portable mode: '), 'data lives next to the exe.'),
        ),
        el('div', { class: 'settings-actions' },
          el('button', { class: 'btn-secondary', onclick: () => api.openPath(state.paths.root) },
            ICONS.folder(), 'Open in Explorer'),
        ),
        el('div', { class: 'settings-actions two-col' },
          el('button', { class: 'btn-secondary', onclick: onExport },
            ICONS.download(), 'Export…'),
          el('button', { class: 'btn-secondary', onclick: onImport },
            ICONS.upload(), 'Import…'),
        ),
      ]),
      state.orphanCount > 0 && renderSettingsSection(
        `Recovery · ${state.orphanCount} unlinked data folder${state.orphanCount === 1 ? '' : 's'}`,
        [
          el('div', { class: 'hint' },
            'Data folders under ', el('code', {}, 'profiles\\'),
            ' that no profile currently claims. Left over from removed or renamed profiles.',
          ),
          el('div', { class: 'settings-actions' },
            el('button', { class: 'btn-secondary', onclick: () => setView('recovery') },
              ICONS.folder(), 'Review & recover…'),
          ),
        ],
      ),
      renderSettingsSection('About', [
        el('div', { class: 'hint' },
          el('b', {}, 'Facet 0.1.0'), ' — one identity, many facets.', el('br'),
          'No network. No token handling. Data stays local.',
        ),
      ]),
      el('div', { class: 'settings-danger' },
        el('button', { class: 'btn-danger', onclick: () => api.quit() }, 'Quit Facet'),
      ),
    ),
  );
}

function viewRecovery() {
  return el('div', { class: 'panel' },
    el('div', { class: 'panel-head' },
      el('div', { class: 'panel-title' }, brandMark(), 'Recover profiles'),
      el('div', { class: 'panel-head-tools' },
        el('button', { class: 'icon-btn', onclick: () => setView('settings') }, ICONS.back()),
      ),
    ),
    el('div', { class: 'form' },
      el('div', { class: 'hint' },
        'Old Chromium data folders in ', el('code', {}, `${state.paths.root}\\profiles`),
        ' that no active profile claims. Recover one to bring back that session; delete to reclaim disk.',
      ),
      state.orphans.length === 0
        ? el('div', { class: 'settings-current' }, el('div', { class: 'hint' }, 'No unlinked folders.'))
        : el('div', { class: 'orphan-list' },
            ...state.orphans.map(o => el('div', { class: 'orphan-row' },
              el('div', { class: 'orphan-body' },
                el('div', { class: 'orphan-slug' },
                  el('code', {}, o.slug),
                  o.hasSession
                    ? el('span', { class: 'orphan-tag has-session' }, 'has session')
                    : el('span', { class: 'orphan-tag' }, 'empty'),
                ),
                el('div', { class: 'orphan-meta' },
                  `${formatBytes(o.size)}`,
                  o.mtime && ` · last used ${formatDate(o.mtime)}`,
                ),
              ),
              el('div', { class: 'orphan-actions' },
                el('button', { class: 'icon-btn', title: 'Open folder',
                  onclick: () => api.openPath(o.path) }, ICONS.folder()),
                el('button', { class: 'btn-mini primary', onclick: () => onRecoverOrphan(o) }, 'Recover'),
                el('button', { class: 'btn-mini danger', onclick: () => onDeleteOrphan(o) }, 'Delete'),
              ),
            )),
          ),
    ),
  );
}

function formatBytes(n) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0; while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 10 ? 0 : 1)} ${units[i]}`;
}

function formatDate(iso) {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

async function onRecoverOrphan(o) {
  // Default the display name to a titlecased slug — user can rename after
  const name = o.slug.replace(/(^|-)([a-z])/g, (_, s, c) => (s ? ' ' : '') + c.toUpperCase());
  const r = await api.recoverOrphan({ slug: o.slug, name, color: 'indigo' });
  if (r && r.ok) {
    state.orphans = await api.listOrphans();
    await refresh(); render();
  }
}

async function onDeleteOrphan(o) {
  state.confirm = {
    orphan: o,
    onConfirm: async () => {
      await api.deleteOrphan({ slug: o.slug });
      state.confirm = null;
      state.orphans = await api.listOrphans();
      await refresh(); render();
    },
  };
  render();
}

function renderSettingsSection(title, children) {
  return el('div', { class: 'settings-section' },
    el('div', { class: 'settings-section-title' }, title),
    ...children.filter(Boolean),
  );
}

function renderToggle(label, key, checked, locked) {
  return el('label', { class: `toggle ${locked ? 'is-locked' : ''}` },
    el('span', { class: 'toggle-label' }, label,
      locked && el('span', { class: 'lock-inline', title: 'Locked by policy' }, ICONS.lock())),
    el('span', { class: `toggle-switch ${checked ? 'is-on' : ''}` },
      el('span', { class: 'toggle-knob' })),
    el('input', { type: 'checkbox', checked: !!checked, disabled: locked,
      style: { position: 'absolute', opacity: 0, pointerEvents: 'none' },
      onchange: (e) => onToggleSetting(key, e.target.checked) }),
  );
}

function lockNotice() {
  return el('div', { class: 'lock-notice' }, ICONS.lock(),
    'Locked by administrator policy (%PROGRAMDATA%\\Facet\\policy.json).');
}

function renderOnboardingOverlay() {
  return el('div', { class: 'confirm-overlay onboarding-overlay',
    onclick: (e) => { if (e.currentTarget === e.target) finishOnboarding(); } },
    el('div', { class: 'confirm-card onboarding-card' },
      el('div', { class: 'onboarding-mark' }, brandMark()),
      el('h4', {}, 'Welcome to Facet'),
      el('p', {}, 'Facet keeps multiple Claude Desktop accounts side-by-side — one profile per account, each in its own data directory. Nothing is shared, nothing is copied.'),
      el('ul', { class: 'onboarding-tips' },
        el('li', {}, el('b', {}, 'Left-click'), ' the tray icon to open this panel.'),
        el('li', {}, el('b', {}, 'Alt + 1…9'), ' launches the profile at that slot.'),
        el('li', {}, el('b', {}, 'Right-click'), ' any profile row for more actions.'),
        el('li', {}, el('b', {}, 'Settings gear'), ' → global hotkey, launch-at-login, custom Claude path.'),
      ),
      el('div', { class: 'actions' },
        el('button', { class: 'btn-primary', onclick: finishOnboarding }, 'Got it'),
      ),
    ),
  );
}

function confirmOverlay() {
  const c = state.confirm;
  // Orphan deletion — different copy, no data-folder checkbox
  if (c.orphan) {
    return el('div', { class: 'confirm-overlay',
      onclick: (e) => { if (e.currentTarget === e.target) { state.confirm = null; render(); } } },
      el('div', { class: 'confirm-card' },
        el('h4', {}, `Delete data folder?`),
        el('p', {}, 'Permanently removes ',
          el('code', {}, `${state.paths.root}\\profiles\\${c.orphan.slug}`),
          c.orphan.hasSession
            ? '. That folder still holds a signed-in session — you will lose it.'
            : '. That folder has no session data.'),
        el('div', { class: 'actions' },
          el('button', { class: 'cancel', onclick: () => { state.confirm = null; render(); } }, 'Cancel'),
          el('button', { class: 'destroy', onclick: c.onConfirm }, 'Delete'),
        ),
      ),
    );
  }
  const dataPath = `${state.paths.root}\\profiles\\${c.profile.slug}`;
  let deleteData = false;
  const checkbox = el('input', { type: 'checkbox',
    onchange: (e) => { deleteData = e.target.checked; },
  });
  return el('div', { class: 'confirm-overlay',
    onclick: (e) => { if (e.currentTarget === e.target) { state.confirm = null; render(); } } },
    el('div', { class: 'confirm-card' },
      el('h4', {}, `Remove “${c.profile.name}”?`),
      el('p', {}, c.profile.adopted
        ? 'This only drops the profile from Facet. Your real Claude data at %APPDATA%\\Claude is left in place.'
        : 'This removes the profile from Facet.'),
      !c.profile.adopted && el('label', { class: 'check' },
        checkbox, el('span', {}, 'Also delete the data folder ', el('code', {}, dataPath)),
      ),
      el('div', { class: 'actions' },
        el('button', { class: 'cancel', onclick: () => { state.confirm = null; render(); } }, 'Cancel'),
        el('button', { class: 'destroy', onclick: async () => {
          await api.remove({ id: c.profile.id, deleteData });
          state.confirm = null;
          await refresh();
          if (state.profiles.length === 0) setView('empty'); else render();
        } }, 'Remove'),
      ),
    ),
  );
}

// ================= actions =================

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

async function refresh() {
  const data = await api.list();
  state.profiles = data.profiles;
  state.running = new Set(data.running);
  state.claudeExe = data.claudeExe;
  state.claudeExeSource = data.claudeExeSource;
  // Show adopt affordance whenever the real Claude data dir exists AND no profile
  // is already adopted. Was previously gated on profiles.length === 0, which meant
  // you couldn't adopt once you'd created any other profile first.
  state.adoptable = data.adoptable && !data.profiles.some(p => p.adopted);
  state.paths = data.paths;
  state.settings = data.settings || {};
  state.lockedSettings = data.lockedSettings || [];
  state.portable = !!data.portable;
  state.orphanCount = data.orphanCount || 0;
  // Onboarding: show once if user has never seen it and no profiles yet
  if (state.settings && state.settings.onboardingComplete === false && state.profiles.length === 0) {
    state.onboarding = true;
  }
}

async function onLaunch(p) {
  const r = await api.launch({ id: p.id });
  if (r.ok) {
    state.running.add(p.id);
    render();
    setTimeout(() => api.hide(), 120);
  }
}

async function onAdopt() {
  const name = (state.adopt.name || '').trim();
  if (!name) { state.adopt.error = 'Give it a name first.'; render(); return; }
  const r = await api.add({ name, color: state.adopt.color, adopted: true });
  if (!r.ok) {
    state.adopt.error = r.error === 'duplicate' ? 'A profile with that name already exists.' : `Error: ${r.error}`;
    render();
    return;
  }
  await refresh(); setView('populated');
}

async function onCreate() {
  const pre = state.add.preflight;
  // If preflight surfaced an orphan warning, the user has to choose "reuse" or "wipe"
  // via the dedicated buttons — the main Create button is disabled in that state.
  if (pre && pre.warn === 'orphan-exists') return;
  return onCreateWith(null);
}

async function onCreateWith(orphanAction) {
  const name = state.add.name.trim();
  if (!name) return;
  if (!state.claudeExe) { state.add.error = 'Claude Desktop is not installed.'; render(); return; }
  const r = await api.add({ name, color: state.add.color, adopted: false, orphanAction });
  if (!r.ok) {
    const messages = {
      'duplicate-name': 'A profile with that name already exists.',
      'already-adopted': 'You can only adopt one existing Claude session.',
      'orphan-exists': 'That name matches an old data folder — pick Reuse or Wipe first.',
      'wipe-failed': 'Could not delete the old data folder. Close any Claude windows and try again.',
    };
    state.add.error = messages[r.error] || `Error: ${r.error}`;
    render();
    return;
  }
  await api.launch({ id: r.profile.id });
  state.add = { name: '', color: 'indigo', error: '', preflight: null };
  await refresh(); setView('populated');
}

let preflightSeq = 0;
async function runPreflight() {
  const seq = ++preflightSeq;
  const name = state.add.name;
  if (!name.trim()) {
    state.add.preflight = null;
    return;
  }
  const pre = await api.preflight({ name, adopted: false });
  if (seq !== preflightSeq) return; // stale, discard
  state.add.preflight = pre;
  render();
}

function beginRename(p) {
  state.rename = { id: p.id, value: p.name, showColorFor: state.rename.showColorFor };
  render();
}

function cancelRename() { state.rename = { id: null, value: '', showColorFor: null }; render(); }

async function commitRename(p) {
  const name = (state.rename.value || '').trim();
  if (!name || name === p.name) { cancelRename(); return; }
  await api.rename({ id: p.id, name });
  state.rename = { id: null, value: '', showColorFor: null };
  await refresh(); render();
}

async function onReorder(p, direction) {
  await api.reorder({ id: p.id, direction });
  await refresh(); render();
}

async function onDuplicate(p) {
  await api.duplicate({ id: p.id });
  await refresh(); render();
}

function askRemove(p) { state.confirm = { profile: p }; render(); }

async function onPickClaudeExe() {
  const r = await api.pickClaudeExe();
  if (!r || !r.ok) return;
  await api.setSettings({ customClaudePath: r.path });
  await refresh(); render();
}

async function onResetCustomPath() {
  await api.setSettings({ customClaudePath: null });
  await refresh(); render();
}

async function onToggleSetting(key, value) {
  await api.setSettings({ [key]: value });
  await refresh(); render();
}

const MOD_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta']);
async function onRecordHotkey(e) {
  e.preventDefault();
  e.stopPropagation();
  if (e.key === 'Escape') { state.hotkeyRecording = false; render(); return; }
  if (MOD_KEYS.has(e.key)) return; // wait for the real key
  const parts = [];
  if (e.ctrlKey) parts.push('Control');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push('Super');
  const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  parts.push(key);
  if (parts.length < 2) return; // require at least one modifier
  const combo = parts.join('+');
  await api.setSettings({ globalHotkey: combo });
  state.hotkeyRecording = false;
  await refresh(); render();
}

async function onExport() {
  const r = await api.exportAll();
  if (r && r.ok) log('exported to ' + r.path);
}

async function onImport() {
  // For MVP we do "merge" (skip duplicates by slug). "Replace" is a later addition.
  const r = await api.importAll({ mode: 'merge' });
  if (r && r.ok) {
    await refresh();
    setView(state.profiles.length ? 'populated' : 'empty');
  }
}

async function finishOnboarding() {
  state.onboarding = false;
  await api.setSettings({ onboardingComplete: true });
  await refresh(); render();
}

function setView(v) {
  state.view = v;
  if (v === 'add') { state.add = { name: '', color: 'indigo', error: '', preflight: null }; }
  state.rename = { id: null, value: '', showColorFor: null };
  state.hotkeyRecording = false;
  render();
  if (v === 'add') setTimeout(() => document.getElementById('profile-name')?.focus(), 40);
  if (v === 'settings' && state.hotkeyRecording) {
    setTimeout(() => document.querySelector('.hotkey-recorder')?.focus(), 40);
  }
  if (v === 'recovery') {
    (async () => { state.orphans = await api.listOrphans(); render(); })();
  }
}

// stub for exports UX — could route to a toast later
function log(msg) { console.log('[facet]', msg); }

// ================= render =================

const views = {
  populated: viewPopulated, empty: viewEmpty, add: viewAdd,
  manage: viewManage, settings: viewSettings, recovery: viewRecovery,
};
const root = document.getElementById('root');

function render() {
  const view = state.profiles.length === 0 && state.view === 'populated' ? 'empty' : state.view;
  // Preserve keyboard focus + caret across full re-renders. Any focused
  // element with an id gets its selection captured and re-applied after the
  // new DOM is in place.
  const focused = document.activeElement;
  const focusedId = focused && focused.id ? focused.id : null;
  const focusedSelStart = focused && 'selectionStart' in focused ? focused.selectionStart : null;
  const focusedSelEnd = focused && 'selectionEnd' in focused ? focused.selectionEnd : null;

  root.innerHTML = '';
  const panelEl = views[view]();
  // Overlays live at the panel level so they render regardless of active view
  if (state.confirm) panelEl.appendChild(confirmOverlay());
  if (state.onboarding) panelEl.appendChild(renderOnboardingOverlay());
  root.appendChild(panelEl);

  if (focusedId) {
    const next = document.getElementById(focusedId);
    if (next) {
      next.focus();
      if (focusedSelStart != null && 'setSelectionRange' in next) {
        try { next.setSelectionRange(focusedSelStart, focusedSelEnd ?? focusedSelStart); } catch {}
      }
    }
  }
  requestAnimationFrame(() => {
    const p = document.querySelector('.panel');
    if (!p) return;
    const prevMax = p.style.maxHeight;
    p.style.maxHeight = 'none';
    // Include overlay content (position:absolute doesn't add to scrollHeight)
    const overlay = p.querySelector(':scope > .confirm-overlay');
    const overlayCard = overlay && overlay.querySelector(':scope > .confirm-card');
    const overlayH = overlayCard ? overlayCard.getBoundingClientRect().height + 96 : 0;
    const h = Math.max(p.scrollHeight, overlayH);
    p.style.maxHeight = prevMax;
    api.resize({ height: h + 12 });
  });
}

function renderInline() {
  const input = document.getElementById('profile-name');
  const hint = input?.closest('.field')?.querySelector('.hint b');
  const btn = document.querySelector('.form-foot .btn-primary');
  if (hint) {
    const slug = slugify(state.add.name);
    hint.textContent = `${state.paths.root}\\profiles\\claude-${slug || '…'}`;
  }
  if (btn) btn.toggleAttribute('disabled', !state.add.name.trim() || !state.claudeExe);
  const err = input?.closest('.field')?.querySelector('.error');
  if (err) err.textContent = state.add.error || '';
}

document.addEventListener('keydown', (e) => {
  if (state.hotkeyRecording) return; // recorder owns keys
  if (e.key === 'Escape') {
    if (state.confirm) { state.confirm = null; render(); return; }
    if (state.rename.id) { cancelRename(); return; }
    if (state.view !== 'populated' && state.profiles.length) { setView('populated'); return; }
    api.hide();
    return;
  }
  if (e.altKey && /^[1-9]$/.test(e.key)) {
    const idx = Number(e.key) - 1;
    if (state.profiles[idx]) { e.preventDefault(); onLaunch(state.profiles[idx]); }
  }
});

api.onRunningChanged((list) => { state.running = new Set(list); render(); });
api.onGotoView((view) => { setView(view); });
api.onStartRename(({ id }) => {
  const p = state.profiles.find(x => x.id === id);
  if (!p) return;
  if (state.view !== 'manage' && state.view !== 'populated') setView('manage');
  beginRename(p);
});
api.onStartRemove(({ id }) => {
  const p = state.profiles.find(x => x.id === id);
  if (!p) return;
  askRemove(p);
});
api.onRefresh(async () => { await refresh(); render(); });

(async () => {
  await refresh();
  if (state.profiles.length === 0) state.view = 'empty';
  render();
})();
