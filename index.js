(function () {
  'use strict';

  const EXT = 'api-config-manager';
  const STORE_KEY = 'api_config_manager_v1';
  const EXPORT_VERSION = '1.2';

  // ---------- 工具函数（必须放在最前面，避免 TDZ 报错） ----------
  const uid = () => 'api_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $$ = () => window.jQuery || window.$;

  // 导入：补 /v1；导出：去掉 /v1
  function urlForImport(url) {
    let u = String(url || '').trim().replace(/\/+$/, '');
    if (!u) return u;
    if (!/\/v1$/i.test(u)) u += '/v1';
    return u;
  }
  function urlForExport(url) {
    return String(url || '').trim().replace(/\/+$/, '').replace(/\/v1$/i, '').replace(/\/+$/, '');
  }

  function normalizeConfig(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    const models = Array.isArray(raw.models)
      ? raw.models.map(m => String(m).trim()).filter(Boolean)
      : typeof raw.models === 'string'
        ? raw.models.split(/[\r\n,]+/).map(m => m.trim()).filter(Boolean)
        : [];
    return {
      id: String(raw.id || uid()),
      name: String(raw.name || '未命名配置'),
      type: String(raw.type || 'proxy'),
      model: String(raw.model || models[0] || ''),
      models,
      proxyUrl: urlForImport(raw.proxyUrl || raw.url || raw.baseUrl || ''),
      apiKey: String(raw.apiKey || raw.key || '').trim(),
    };
  }

  function load() {
    try {
      const x = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (Array.isArray(x)) return x.map(normalizeConfig);
    } catch (e) {
      console.warn(`[${EXT}]`, e);
    }
    return [];
  }

  // ---------- 状态 ----------
  let configs = load();
  let selected = new Set();
  let searchText = '';
  let root = null;
  let statusTimer = null;

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(configs)); } catch (e) { console.warn(`[${EXT}]`, e); }
  }

  function status(text, bad) {
    const el = root && root.querySelector('#am-status');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('bad', !!bad);
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { el.textContent = ''; }, 4000);
  }

  function maskKey(k) {
    if (!k) return '（无）';
    if (k.length <= 10) return '••••••';
    return k.slice(0, 4) + '••••' + k.slice(-3);
  }

  // ---------- 导入 / 导出 ----------
  function parseImport(text) {
    let obj;
    try { obj = JSON.parse(String(text).replace(/^﻿/, '')); } catch (e) { throw new Error('不是有效的 JSON'); }
    let list = null;
    if (Array.isArray(obj)) list = obj;
    else if (obj && Array.isArray(obj.configs)) list = obj.configs;
    else if (obj && (obj.proxyUrl || obj.url || obj.baseUrl)) list = [obj];
    if (!list || !list.length) throw new Error('没有找到 configs 数组');
    return list.map(normalizeConfig);
  }

  function importConfigs(text) {
    const incoming = parseImport(text);
    let added = 0, updated = 0;
    incoming.forEach(c => {
      let idx = configs.findIndex(x => x.id === c.id);
      if (idx < 0) idx = configs.findIndex(x => x.name === c.name && x.proxyUrl === c.proxyUrl && x.apiKey === c.apiKey);
      if (idx >= 0) { c.id = configs[idx].id; configs[idx] = c; updated++; }
      else { configs.push(c); added++; }
    });
    save();
    render();
    status(`导入完成：新增 ${added} 个，覆盖 ${updated} 个（URL 已补 /v1）`);
  }

  function buildExport(list) {
    return {
      version: EXPORT_VERSION,
      exportTime: new Date().toISOString(),
      configs: list.map(c => ({
        id: c.id,
        name: c.name,
        type: c.type,
        model: c.model,
        models: c.models.slice(),
        proxyUrl: urlForExport(c.proxyUrl),
        apiKey: c.apiKey,
      })),
    };
  }

  function exportTarget() {
    const list = selected.size ? configs.filter(c => selected.has(c.id)) : configs;
    return list;
  }

  function downloadText(filename, text) {
    const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    const u = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = u;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 1000);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(() => true).catch(() => legacyCopy(text));
    }
    return Promise.resolve(legacyCopy(text));
  }
  function legacyCopy(text) {
    const t = document.createElement('textarea');
    t.value = text;
    t.style.position = 'fixed';
    t.style.opacity = '0';
    document.body.appendChild(t);
    t.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    t.remove();
    return ok;
  }

  // ---------- 应用到酒馆 API 连接（Chat Completion → 自定义） ----------
  function applyConfig(c) {
    const $ = $$();
    if (!$) { status('未找到 jQuery，无法应用', true); return; }
    try {
      $('#main_api').val('openai').trigger('change');
      $('#chat_completion_source').val('custom').trigger('change');
      $('#custom_api_url_text').val(c.proxyUrl).trigger('input');
      $('#api_key_custom').val(c.apiKey).trigger('input');

      const sel = $('#model_custom_select');
      if (sel.length && c.models.length) {
        sel.empty();
        c.models.forEach(m => sel.append($('<option>').val(m).text(m)));
        if (c.model) sel.val(c.model);
        sel.trigger('change');
      }
      if (c.model) $('#custom_model_id').val(c.model).trigger('input');

      const btn = document.getElementById('api_button_openai');
      if (btn) btn.click();
      status(`已应用「${c.name}」并尝试连接`);
    } catch (e) {
      console.error(`[${EXT}] 应用失败`, e);
      status('应用失败，请查看控制台', true);
    }
  }

  // ---------- 弹窗 ----------
  function showModal(title, html, done, label) {
    document.querySelector('#am-modal')?.remove();
    const m = document.createElement('div');
    m.id = 'am-modal';
    m.className = 'am-modal-bg';
    m.innerHTML =
      `<section class="am-modal"><header>${esc(title)}<button type="button" class="am-x">×</button></header>` +
      `<div class="am-modal-content">${html}</div>` +
      `<footer><button type="button" class="am-btn am-light am-cancel">取消</button>` +
      `<button type="button" class="am-btn am-primary am-ok">${esc(label || '确定')}</button></footer></section>`;
    document.body.appendChild(m);
    const close = () => m.remove();
    m.querySelector('.am-x').onclick = close;
    m.querySelector('.am-cancel').onclick = close;
    m.onclick = e => { if (e.target === m) close(); };
    m.querySelector('.am-ok').onclick = () => { if (done(m) !== false) close(); };
    const first = m.querySelector('input,textarea');
    if (first) first.focus();
  }

  function editModal(c) {
    const isNew = !c;
    const cfg = c || normalizeConfig({ name: '新配置', proxyUrl: '' });
    showModal(
      isNew ? '新建配置' : '编辑配置',
      `<label>名称</label><input id="am-f-name" class="am-input" value="${esc(cfg.name)}">` +
      `<label>代理地址（会自动补 /v1）</label><input id="am-f-url" class="am-input" value="${esc(cfg.proxyUrl)}" placeholder="https://example.com">` +
      `<label>API Key</label><input id="am-f-key" class="am-input" value="${esc(cfg.apiKey)}">` +
      `<label>当前模型</label><input id="am-f-model" class="am-input" value="${esc(cfg.model)}">` +
      `<label>模型列表（每行一个）</label><textarea id="am-f-models" class="am-textarea">${esc(cfg.models.join('\n'))}</textarea>`,
      m => {
        const name = m.querySelector('#am-f-name').value.trim();
        const url = urlForImport(m.querySelector('#am-f-url').value);
        if (!name) { status('名称不能为空', true); return false; }
        if (!/^https?:\/\/\S+$/i.test(url)) { status('请输入有效的 http/https 地址', true); return false; }
        const models = m.querySelector('#am-f-models').value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        const next = normalizeConfig({
          id: cfg.id,
          name,
          type: cfg.type,
          model: m.querySelector('#am-f-model').value.trim() || models[0] || '',
          models,
          proxyUrl: url,
          apiKey: m.querySelector('#am-f-key').value.trim(),
        });
        if (isNew) configs.push(next);
        else configs[configs.findIndex(x => x.id === cfg.id)] = next;
        save();
        render();
        status('已保存');
      },
      '保存'
    );
  }

  function pasteModal() {
    showModal(
      '粘贴 JSON 导入',
      '<p>粘贴导出格式的 JSON（含 configs 数组）。导入时代理地址会自动补上 /v1；同 id 的配置会被覆盖。</p>' +
      '<textarea id="am-paste" class="am-textarea" placeholder=\'{"version":"1.2","configs":[...]}\'></textarea>',
      m => {
        const text = m.querySelector('#am-paste').value.trim();
        if (!text) { status('内容为空', true); return false; }
        try { importConfigs(text); } catch (e) { status('导入失败：' + e.message, true); return false; }
      },
      '导入'
    );
  }

  function confirmModal(title, text, onOk, label) {
    showModal(title, `<p>${esc(text)}</p>`, () => { onOk(); }, label || '确定');
  }

  // ---------- 渲染 ----------
  function visibleConfigs() {
    const q = searchText.trim().toLowerCase();
    if (!q) return configs;
    return configs.filter(c => (c.name + ' ' + c.proxyUrl + ' ' + c.model).toLowerCase().includes(q));
  }

  function render() {
    if (!root) return;
    const list = visibleConfigs();
    const allChecked = list.length > 0 && list.every(c => selected.has(c.id));

    root.innerHTML =
      `<div class="am-wrap">` +
      `<div class="am-top"><div><b>API 配置管理</b><small>${configs.length} 个配置 · 已选 ${selected.size} 个</small></div>` +
      `<button class="am-btn am-primary" data-a="new">＋ 新建</button></div>` +
      `<div class="am-tools">` +
      `<button class="am-btn am-light" data-a="import-file">导入文件</button>` +
      `<button class="am-btn am-light" data-a="import-paste">粘贴导入</button>` +
      `<button class="am-btn am-light" data-a="export">导出${selected.size ? '选中' : '全部'}</button>` +
      `<button class="am-btn am-light" data-a="copy-json">复制 JSON</button>` +
      `<input id="am-file-input" type="file" accept=".json,application/json,text/plain" hidden>` +
      `</div>` +
      `<div class="am-tools">` +
      `<input id="am-search" class="am-input" placeholder="搜索名称 / 地址 / 模型…" value="${esc(searchText)}">` +
      `<label class="am-check"><input type="checkbox" id="am-all" ${allChecked ? 'checked' : ''}> 全选</label>` +
      `<button class="am-btn am-light danger" data-a="delete-selected" ${selected.size ? '' : 'disabled'}>删除选中</button>` +
      `</div>` +
      `<div class="am-list">` +
      list.map(c =>
        `<article class="am-card">` +
        `<div class="am-card-head"><label class="am-check"><input type="checkbox" data-sel="${esc(c.id)}" ${selected.has(c.id) ? 'checked' : ''}></label>` +
        `<b class="am-title" title="${esc(c.name)}">${esc(c.name)}</b></div>` +
        `<div class="am-meta">模型：${esc(c.model || '（未设置）')} · 共 ${c.models.length} 个</div>` +
        `<div class="am-meta am-url" title="${esc(c.proxyUrl)}">${esc(c.proxyUrl)}</div>` +
        `<div class="am-meta">Key：${esc(maskKey(c.apiKey))}</div>` +
        `<div class="am-actions"><button data-a="apply" data-id="${esc(c.id)}">应用</button>` +
        `<button data-a="edit" data-id="${esc(c.id)}">编辑</button>` +
        `<button class="danger" data-a="delete" data-id="${esc(c.id)}">删除</button></div>` +
        `</article>`
      ).join('') +
      (!configs.length ? '<div class="am-empty">还没有配置，点「导入文件」或「粘贴导入」开始</div>' : '') +
      (configs.length && !list.length ? '<div class="am-empty">没有匹配的配置</div>' : '') +
      `</div><div id="am-status"></div></div>`;

    root.querySelectorAll('[data-a]').forEach(b => { b.onclick = () => action(b.dataset.a, b.dataset.id); });
    root.querySelectorAll('[data-sel]').forEach(cb => {
      cb.onchange = () => {
        if (cb.checked) selected.add(cb.dataset.sel); else selected.delete(cb.dataset.sel);
        render();
      };
    });
    root.querySelector('#am-all').onchange = e => {
      visibleConfigs().forEach(c => { if (e.target.checked) selected.add(c.id); else selected.delete(c.id); });
      render();
    };
    root.querySelector('#am-file-input').onchange = async e => {
      const file = e.target.files && e.target.files[0];
      if (file) {
        try { importConfigs(await file.text()); } catch (err) { status('导入失败：' + err.message, true); }
      }
      e.target.value = '';
    };
    root.querySelector('#am-search').oninput = e => {
      const p = e.target.selectionStart;
      searchText = e.target.value;
      render();
      const n = root.querySelector('#am-search');
      n.focus();
      try { n.setSelectionRange(p, p); } catch (err) { /* ignore */ }
    };
  }

  function action(a, id) {
    const c = configs.find(x => x.id === id);
    if (a === 'new') editModal(null);
    else if (a === 'edit' && c) editModal(c);
    else if (a === 'apply' && c) applyConfig(c);
    else if (a === 'delete' && c) {
      confirmModal('删除配置', `确定删除「${c.name}」吗？`, () => {
        configs = configs.filter(x => x.id !== id);
        selected.delete(id);
        save(); render(); status('已删除');
      }, '删除');
    }
    else if (a === 'delete-selected') {
      if (!selected.size) return;
      confirmModal('批量删除', `确定删除选中的 ${selected.size} 个配置吗？`, () => {
        configs = configs.filter(x => !selected.has(x.id));
        selected.clear();
        save(); render(); status('已删除');
      }, '删除');
    }
    else if (a === 'import-file') root.querySelector('#am-file-input')?.click();
    else if (a === 'import-paste') pasteModal();
    else if (a === 'export') {
      const list = exportTarget();
      if (!list.length) { status('没有可导出的配置', true); return; }
      const d = new Date();
      const stamp = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
      downloadText(`api-configs-${stamp}.json`, JSON.stringify(buildExport(list), null, 2));
      status(`已导出 ${list.length} 个配置（URL 已去掉 /v1）`);
    }
    else if (a === 'copy-json') {
      const list = exportTarget();
      if (!list.length) { status('没有可复制的配置', true); return; }
      copyText(JSON.stringify(buildExport(list), null, 2)).then(ok => status(ok ? `已复制 ${list.length} 个配置的 JSON` : '复制失败，请改用导出文件', !ok));
    }
  }

  // ---------- 挂载 ----------
  function createPanel() {
    const panel = document.createElement('div');
    panel.id = 'api-config-manager-inline';
    panel.innerHTML =
      `<div class="inline-drawer"><div class="inline-drawer-toggle inline-drawer-header"><b>API 配置管理器</b>` +
      `<div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>` +
      `<div class="inline-drawer-content"><div id="am-manager-root"></div></div></div>`;
    root = panel.querySelector('#am-manager-root');
    render();
    return panel;
  }

  function mount() {
    if (document.getElementById('api-config-manager-inline')) return true;
    const target = document.querySelector('#rm_api_block') || document.querySelector('#extensions_settings2');
    if (!target) return false;
    target.appendChild(createPanel());
    console.log(`[${EXT}] 面板已挂载`);
    return true;
  }

  function init() {
    if (mount()) return;
    let tries = 0;
    const t = setInterval(() => {
      tries++;
      if (mount() || tries > 120) clearInterval(t);
    }, 1000);
  }

  window.apiConfigManager = {
    getConfigs: () => buildExport(configs),
    importText: importConfigs,
    urlForImport,
    urlForExport,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
