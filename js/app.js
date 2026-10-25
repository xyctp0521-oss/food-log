/* UI 层 */
(function () {
  'use strict';

  const { DIMS, summarize, avatarColor } = window.FoodUtil;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  // 用户输入（店名/短评）一律经此函数再进 innerHTML
  // 实体在运行时拼接，避免源码里的 & 被工具链吞掉
  const AMP = String.fromCharCode(38);
  function esc(s) {
    return String(s == null ? '' : s)
      .split(AMP).join(AMP + 'amp;')
      .split('<').join(AMP + 'lt;')
      .split('>').join(AMP + 'gt;')
      .split('"').join(AMP + 'quot;')
      .split("'").join(AMP + '#39;');
  }
  const n1 = v => (Math.round(Number(v || 0) * 10) / 10).toFixed(1);
  const bar = (v) => `<div class="bar-track"><div class="bar-fill" style="width:${Math.max(0, Math.min(100, (v / 5) * 100))}%"></div></div>`;

  const TAGS = ['值得二刷', '踩雷', '排队久', '性价比高', '环境好', '服务好', '适合聚餐', '一人食', '分量足', '要预约'];
  const NEG_TAGS = ['踩雷', '排队久'];

  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  const UI = {
    page: 'page-rank',
    q: '', cat: '', sort: 'score',
    draft: { place: null, placeIsNew: false, scores: {}, tags: [], editingId: null },
    openPlaceId: null
  };

  /* ================= Toast ================= */
  let toastTimer;
  function toast(msg, ms) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, ms || 2000);
  }

  /* ================= 导航 ================= */
  function go(pageId) {
    UI.page = pageId;
    $$('.page').forEach(p => { p.hidden = p.id !== pageId; });
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.page === pageId));
    window.scrollTo(0, 0);
    if (pageId === 'page-rank') renderRank();
    if (pageId === 'page-me') renderMe();
    if (pageId === 'page-add') resetAdd();
  }

  $$('.tab').forEach(t => t.addEventListener('click', () => go(t.dataset.page)));

  /* ================= 榜单 ================= */
  function renderRank() {
    const q = UI.q.trim().toLowerCase();
    let list = Store.places.filter(p => {
      if (UI.cat && p.category !== UI.cat) return false;
      if (!q) return true;
      return [p.name, p.category, p.address].join(' ').toLowerCase().includes(q);
    });

    const withScore = list.map(p => ({ p, s: summarize(Store.ratingsOf(p.id)) }));

    if (UI.sort === 'score') withScore.sort((a, b) => (b.s.total - a.s.total) || (b.s.count - a.s.count));
    else if (UI.sort === 'count') withScore.sort((a, b) => (b.s.count - a.s.count) || (b.s.total - a.s.total));
    else if (UI.sort === 'cost') withScore.sort((a, b) => (Number(b.p.avgCost) || 0) - (Number(a.p.avgCost) || 0));
    else withScore.sort((a, b) => String(b.p.createdAt || '').localeCompare(String(a.p.createdAt || '')));

    const box = $('#place-list');
    box.innerHTML = withScore.map(({ p, s }) => {
      const tags = collectTags(p.id).slice(0, 3);
      return `<div class="pcard" data-id="${esc(p.id)}">
        <div class="pcard-head">
          <div class="pcard-name">${esc(p.name)}</div>
          ${s.count ? `<div class="pcard-score">${n1(s.total)}<small> 分</small></div>` : '<div class="pcard-score" style="font-size:13px;color:#7A7268">待评</div>'}
        </div>
        <div class="pcard-meta">
          ${p.category ? `<span>${esc(p.category)}</span><span class="dot">·</span>` : ''}
          ${p.avgCost ? `<span>人均 ¥${esc(p.avgCost)}</span><span class="dot">·</span>` : ''}
          <span>${s.count} 人评过</span>
        </div>
        ${s.count ? `<div class="bars">${DIMS.map(d => `<div class="bar"><div class="bar-t">${d.label}</div>${bar(s[d.key])}</div>`).join('')}</div>` : ''}
        ${tags.length ? `<div class="tagline">${tags.map(t => `<span class="mini-tag${NEG_TAGS.includes(t) ? ' bad' : ''}">${esc(t)}</span>`).join('')}</div>` : ''}
      </div>`;
    }).join('');

    $('#rank-empty').hidden = withScore.length > 0;
    const members = Store.allMembers();
    $('#rank-sub').textContent = `${Store.places.length} 家店 · ${members.length} 位小伙伴`;

    $$('#place-list .pcard').forEach(el => el.addEventListener('click', () => openPlace(el.dataset.id)));

    // 品类 chips
    const cats = Store.categories();
    $('#cat-chips').innerHTML = `<button class="chip${UI.cat ? '' : ' on'}" data-cat="">全部</button>` +
      cats.map(c => `<button class="chip${UI.cat === c ? ' on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('');
    $$('#cat-chips .chip').forEach(c => c.addEventListener('click', () => { UI.cat = c.dataset.cat; renderRank(); }));

    $$('.sort-btn').forEach(b => b.classList.toggle('active', b.dataset.sort === UI.sort));
    $('#cat-list').innerHTML = cats.map(c => '<option value="' + esc(c) + '"></option>').join('');
  }

  function collectTags(placeId) {
    const counter = {};
    Store.ratingsOf(placeId).forEach(r => (r.tags || []).forEach(t => { counter[t] = (counter[t] || 0) + 1; }));
    return Object.entries(counter).sort((a, b) => b[1] - a[1]).map(e => e[0]);
  }

  $('#search').addEventListener('input', e => { UI.q = e.target.value; renderRank(); });
  $$('.sort-btn').forEach(b => b.addEventListener('click', () => { UI.sort = b.dataset.sort; renderRank(); }));

  /* ================= 店铺详情 ================= */
  function openPlace(id) {
    const p = Store.placeById(id);
    if (!p) return;
    UI.openPlaceId = id;
    const list = Store.ratingsOf(id);
    const s = summarize(list);
    const my = list.find(r => r.nick === Store.myNick());

    $('#sheet').innerHTML = `
      <div class="close-bar">
        <button class="sheet-close" id="sheet-x">✕</button>
        <h2>${esc(p.name)}</h2>
        <div class="pcard-meta">
          ${p.category ? `<span>${esc(p.category)}</span><span class="dot">·</span>` : ''}
          ${p.avgCost ? `<span>人均 ¥${esc(p.avgCost)}</span><span class="dot">·</span>` : ''}
          ${p.address ? `<span>${esc(p.address)}</span>` : ''}
        </div>
      </div>

      ${s.count ? `<div class="card">
        <div class="taste-line"><div class="l">综合</div><div class="t"><div class="f" style="width:${(s.total / 5) * 100}%"></div></div><div class="v">${n1(s.total)}</div></div>
        ${DIMS.map(d => `<div class="taste-line"><div class="l">${d.label}</div><div class="t"><div class="f" style="width:${(s[d.key] / 5) * 100}%"></div></div><div class="v">${n1(s[d.key])}</div></div>`).join('')}
        <p class="hint">${s.count} 人评过${p.avgCost ? ` · 人均 ¥${esc(p.avgCost)}` : ''}</p>
      </div>` : '<div class="card"><p class="hint">还没人评分，来当第一个。</p></div>'}

      <div class="list">
        ${list.map(r => {
          const total = DIMS.reduce((a, d) => a + (Number(r[d.key]) || 0), 0) / DIMS.length;
          return `<div class="rate-item">
            <div class="rate-head">
              <div class="avatar" style="background:${avatarColor(r.nick)}">${esc(r.nick.slice(0, 1))}</div>
              <div class="who">${esc(r.nick)}</div>
              <div class="sc">${n1(total)}</div>
            </div>
            <div class="rate-bars">${DIMS.map(d => `<div class="bar"><div class="bar-t">${d.label}</div>${bar(r[d.key])}</div>`).join('')}</div>
            ${r.comment ? `<div class="rate-cmt">${esc(r.comment)}</div>` : ''}
            ${(r.tags || []).length ? `<div class="tagline">${r.tags.map(t => `<span class="mini-tag${NEG_TAGS.includes(t) ? ' bad' : ''}">${esc(t)}</span>`).join('')}</div>` : ''}
            <div class="rate-date">${esc(r.visitedAt || '')}</div>
            ${r.nick === Store.myNick() ? `<div class="rate-edit" data-edit="${esc(r.id)}">修改我的评分</div>` : ''}
          </div>`;
        }).join('')}
      </div>

      <button class="btn-main" id="sheet-rate">${my ? '修改我的评分' : '我也评一下'}</button>
    `;
    $('#sheet-mask').hidden = false;
    $('#sheet-x').addEventListener('click', closeSheet);
    $('#sheet-rate').addEventListener('click', () => { closeSheet(); startRate(p, my || null); });
    $$('#sheet [data-edit]').forEach(el => el.addEventListener('click', () => {
      closeSheet(); startRate(p, my || null);
    }));
  }
  function closeSheet() { $('#sheet-mask').hidden = true; UI.openPlaceId = null; }
  $('#sheet-mask').addEventListener('click', e => { if (e.target.id === 'sheet-mask') closeSheet(); });

  /* ================= 记一笔 ================= */
  function resetAdd() {
    UI.draft = { place: null, placeIsNew: false, scores: {}, tags: [], editingId: null };
    $('#step-pick').hidden = false;
    $('#step-newplace').hidden = true;
    $('#step-rate').hidden = true;
    $('#pick-search').value = '';
    $('#add-tip').textContent = '';
    renderPickList('');
    renderStars();
    renderTagChips();
  }

  function renderPickList(q) {
    const key = q.trim().toLowerCase();
    const list = Store.places
      .filter(p => !key || p.name.toLowerCase().includes(key) || (p.category || '').toLowerCase().includes(key))
      .slice(0, 20);
    $('#pick-list').innerHTML = list.map(p => `<div class="pick-item" data-id="${esc(p.id)}">
        <div><div class="n">${esc(p.name)}</div><div class="m">${esc(p.category || '未分类')}${p.avgCost ? ' · 人均 ¥' + esc(p.avgCost) : ''}</div></div>
        <div style="font-size:12px;color:#7A7268">${Store.ratingsOf(p.id).length} 评</div>
      </div>`).join('') || (key ? '<p class="hint">没找到，点下面新建</p>' : '');
    $$('#pick-list .pick-item').forEach(el => el.addEventListener('click', () => {
      startRate(Store.placeById(el.dataset.id), null);
    }));
  }
  $('#pick-search').addEventListener('input', e => renderPickList(e.target.value));

  $('#btn-new-place').addEventListener('click', () => {
    const v = $('#pick-search').value.trim();
    $('#step-pick').hidden = true;
    $('#step-newplace').hidden = false;
    $('#np-name').value = v;
    $('#np-name').focus();
  });
  $('#btn-np-cancel').addEventListener('click', () => {
    $('#step-newplace').hidden = true; $('#step-pick').hidden = false;
  });
  $('#btn-np-next').addEventListener('click', () => {
    const name = $('#np-name').value.trim();
    if (!name) return toast('店名得填');
    const cost = Number($('#np-cost').value) || null;
    startRate({
      id: 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      name,
      category: $('#np-cat').value.trim(),
      avgCost: cost,
      address: $('#np-addr').value.trim(),
      createdAt: new Date().toISOString()
    }, null, true);
  });

  function startRate(place, existing, isNew) {
    if (!Store.myNick()) {
      toast('先去设置里填个昵称');
      return go('page-set');
    }
    go('page-add');   // 内部 resetAdd() 会清空草稿，必须先切页再写值

    UI.draft = {
      place,
      placeIsNew: !!isNew,
      scores: {},
      tags: [],
      editingId: existing ? existing.id : null
    };
    if (existing) {
      DIMS.forEach(d => { UI.draft.scores[d.key] = existing[d.key] || 0; });
      UI.draft.tags = (existing.tags || []).slice();
      $('#r-comment').value = existing.comment || '';
      $('#r-date').value = existing.visitedAt || today();
    } else {
      DIMS.forEach(d => { UI.draft.scores[d.key] = 0; });
      $('#r-comment').value = '';
      $('#r-date').value = today();
    }

    $('#step-pick').hidden = true;
    $('#step-newplace').hidden = true;
    $('#step-rate').hidden = false;
    $('#picked-name').innerHTML = esc(place.name) +
      `<small>${esc(place.category || '未分类')}${place.avgCost ? ' · 人均 ¥' + esc(place.avgCost) : ''}${isNew ? ' · 新店' : ''}</small>`;
    renderStars();
    renderTagChips();
  }

  function renderStars() {
    $$('.stars').forEach(box => {
      const dim = box.dataset.dim;
      const v = UI.draft.scores[dim] || 0;
      box.innerHTML = [1, 2, 3, 4, 5].map(i => `<span class="star${i <= v ? ' on' : ''}" data-i="${i}">★</span>`).join('');
      const valEl = box.parentElement.querySelector('.dim-val');
      if (valEl) valEl.textContent = v ? v + '.0' : '-';
      $$('.star', box).forEach(s => s.addEventListener('click', () => {
        const i = Number(s.dataset.i);
        UI.draft.scores[dim] = (UI.draft.scores[dim] === i) ? 0 : i;   // 再点一次取消
        renderStars();
      }));
    });
  }

  function renderTagChips() {
    $('#tag-chips').innerHTML = TAGS.map(t =>
      `<button class="chip${UI.draft.tags.includes(t) ? ' on' : ''}" data-tag="${esc(t)}">${esc(t)}</button>`).join('');
    $$('#tag-chips .chip').forEach(c => c.addEventListener('click', () => {
      const t = c.dataset.tag;
      const i = UI.draft.tags.indexOf(t);
      if (i >= 0) UI.draft.tags.splice(i, 1); else UI.draft.tags.push(t);
      renderTagChips();
    }));
  }

  $('#btn-rate-cancel').addEventListener('click', resetAdd);

  $('#btn-submit').addEventListener('click', async () => {
    const s = UI.draft.scores;
    if (DIMS.every(d => !s[d.key])) return toast('至少给「味道」打个分');
    const btn = $('#btn-submit');
    btn.disabled = true; btn.textContent = '提交中…';
    try {
      const d = UI.draft;
      if (d.placeIsNew) {
        await Store.addPlace(d.place);
        $('#add-tip').className = 'tip ok';
        $('#add-tip').textContent = `新店「${d.place.name}」已创建`;
      }
      const ratings = Store.myRatings().slice();
      const rec = {
        id: d.editingId || ('r_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5)),
        placeId: d.place.id,
        placeName: d.place.name,
        taste: s.taste || 0, env: s.env || 0, service: s.service || 0, value: s.value || 0,
        comment: $('#r-comment').value.trim(),
        tags: d.tags.slice(),
        visitedAt: $('#r-date').value || today(),
        updatedAt: new Date().toISOString()
      };
      const idx = ratings.findIndex(r => r.id === rec.id);
      if (idx >= 0) ratings[idx] = rec; else ratings.push(rec);

      const res = await Store.saveMyRatings(ratings);
      $('#add-tip').className = 'tip ok';
      $('#add-tip').textContent = res.queued ? '已存本地，联网后自动补交' : '提交成功';
      toast(res.queued ? '离线保存了，联网后再传' : '记下了 ✓');
      setTimeout(() => { resetAdd(); go('page-rank'); }, 900);
    } catch (e) {
      $('#add-tip').className = 'tip err';
      $('#add-tip').textContent = '失败：' + e.message + '（已存本地）';
      toast('同步失败：' + e.message, 3200);
    } finally {
      btn.disabled = false; btn.textContent = '提交评分';
    }
  });

  /* ================= 我的 ================= */
  function renderMe() {
    const nick = Store.myNick() || '我';
    $('#me-name').textContent = nick;
    const ratings = Store.myRatings();
    const s = summarize(ratings);

    const byPlace = ratings.reduce((m, r) => { m[r.placeId] = r; return m; }, {});
    const best = ratings.map(r => {
      const t = DIMS.reduce((a, d) => a + (Number(r[d.key]) || 0), 0) / DIMS.length;
      return { r, t };
    }).sort((a, b) => b.t - a.t)[0];

    $('#profile-card').innerHTML = `
      <div class="stat-row">
        <div class="stat"><b>${ratings.length}</b><span>评过</span></div>
        <div class="stat"><b>${ratings.length ? n1(s.total) : '-'}</b><span>均分</span></div>
        <div class="stat"><b>${Store.places.length}</b><span>收录店</span></div>
      </div>
      ${ratings.length ? `<div style="margin-top:14px">
        ${DIMS.map(d => `<div class="taste-line"><div class="l">${d.label}</div><div class="t"><div class="f" style="width:${(s[d.key] / 5) * 100}%"></div></div><div class="v">${n1(s[d.key])}</div></div>`).join('')}
        <p class="hint">你在「${DIMS.reduce((a, d) => (s[d.key] > s[a.key] ? d : a), DIMS[0]).label}」上要求最高${best ? ` · 最高分：${esc(best.r.placeName)} ${n1(best.t)}` : ''}</p>
      </div>` : '<p class="hint" style="margin-top:12px">还没有评分记录，去「记一笔」开张。</p>'}
    `;

    const rows = ratings.slice().sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    $('#my-list').innerHTML = rows.map(r => {
      const p = Store.placeById(r.placeId);
      const t = DIMS.reduce((a, d) => a + (Number(r[d.key]) || 0), 0) / DIMS.length;
      return `<div class="pcard" data-id="${esc(r.placeId)}">
        <div class="pcard-head">
          <div class="pcard-name">${esc(r.placeName || (p && p.name) || '未知')}</div>
          <div class="pcard-score">${n1(t)}<small> 分</small></div>
        </div>
        <div class="pcard-meta">${esc(r.visitedAt || '')}${r.comment ? '<span class="dot">·</span>' : ''}${r.comment ? `<span style="max-width:70%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.comment)}</span>` : ''}</div>
        ${(r.tags || []).length ? `<div class="tagline">${r.tags.map(x => `<span class="mini-tag${NEG_TAGS.includes(x) ? ' bad' : ''}">${esc(x)}</span>`).join('')}</div>` : ''}
      </div>`;
    }).join('');
    $('#me-empty').hidden = rows.length > 0;
    $$('#my-list .pcard').forEach(el => el.addEventListener('click', () => {
      const p = Store.placeById(el.dataset.id);
      if (p) openPlace(p.id);
    }));
    $('#me-sub').textContent = ratings.length ? `共 ${ratings.length} 条评价` : '还没有记录';
  }

  /* ================= 设置 ================= */
  function loadSet() {
    const c = Store.cfg();
    $('#set-nick').value = c.nick || '';
    $('#set-owner').value = c.owner || '';
    $('#set-repo').value = c.repo || '';
    $('#set-token').value = c.token || '';
    $('#set-branch').value = c.branch || 'master';
    renderSyncState();
  }
  function renderSyncState() {
    const c = Store.cfg();
    const n = Store.pending.length;
    const t = Store.lastSync ? new Date(Store.lastSync).toLocaleString('zh-CN') : '从未';
    $('#sync-state').textContent = `上次同步：${t}` + (n ? ` · ${n} 条待补交` : '') + (c.nick ? ` · 身份：${c.nick}` : ' · 未设置昵称');
  }

  $('#btn-save-set').addEventListener('click', async () => {
    const nick = $('#set-nick').value.trim();
    if (!nick) return toast('昵称必须填');
    Store.saveCfg({
      nick,
      owner: $('#set-owner').value.trim(),
      repo: $('#set-repo').value.trim(),
      token: $('#set-token').value.trim(),
      branch: $('#set-branch').value.trim() || 'master'
    });
    toast('已保存');
    renderSyncState();
    if (Store.ready) await doSync();
  });

  $('#btn-test').addEventListener('click', async () => {
    const owner = $('#set-owner').value.trim(), repo = $('#set-repo').value.trim(), token = $('#set-token').value.trim();
    const branch = $('#set-branch').value.trim() || 'main';
    if (!owner || !repo || !token) return toast('三个字段都要填');
    const hint = $('#set-hint');
    hint.textContent = '测试中…';
    const c = new GitHubClient({ owner, repo, token, branch });
    try {
      const info = await c.checkRepo();     // 真正校验仓库存在 + 令牌可读
      if (info.defaultBranch && info.defaultBranch !== branch) {
        hint.textContent = `⚠️ 能连上，但仓库默认分支是 ${info.defaultBranch}，你填的是 ${branch}`;
        hint.style.color = '#E8A33D';
      } else {
        hint.textContent = '✅ 连上了，仓库和令牌都没问题';
        hint.style.color = 'var(--good)';
      }
    } catch (e) {
      hint.textContent = '❌ ' + (e.status === 401 || e.status === 403 ? '令牌无效或没有仓库权限' : e.message);
      hint.style.color = 'var(--bad)';
    }
  });

  $('#btn-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(Store.exportAll(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `探店簿备份_${today()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('已导出');
  });

  $('#btn-import').addEventListener('click', () => $('#file-import').click());
  $('#file-import').addEventListener('change', e => {
    const f = e.target.files[0];
    if (!f) return;
    const fr = new FileReader();
    fr.onload = () => {
      try {
        Store.importAll(JSON.parse(fr.result));
        toast('导入成功');
        renderRank(); renderMe(); renderSyncState();
      } catch (err) { toast('导入失败：' + err.message); }
    };
    fr.readAsText(f);
    e.target.value = '';
  });

  /* ================= 同步 ================= */
  async function doSync(silent) {
    if (!Store.ready) { if (!silent) toast('先配置昵称和 GitHub 仓库'); return; }
    const btn = $('#btn-sync');
    btn.classList.add('spin');
    try {
      await Store.pull();
      const fl = await Store.flush();
      renderRank();
      if (UI.page === 'page-me') renderMe();
      renderSyncState();
      if (!silent) toast(fl ? `同步完成，补交 ${fl} 条` : '同步完成');
    } catch (e) {
      toast('同步失败：' + e.message, 3000);
    } finally {
      btn.classList.remove('spin');
    }
  }
  $('#btn-sync').addEventListener('click', () => doSync(false));

  /* ================= 启动 ================= */
  function boot() {
    Store.init();
    loadSet();
    renderRank();
    if (!Store.myNick()) {
      go('page-set');
      toast('先填昵称和 GitHub 仓库配置，就能开用了');
    } else {
      doSync(true);
    }
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => { /* 本地 http 下可忽略 */ });
    }
  }

  boot();
})();
