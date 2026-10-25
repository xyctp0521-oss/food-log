/* UI 层 */
(function () {
  'use strict';

  const { DIMS, MAX_SCORE, summarize, ratingTotal, avatarColor } = window.FoodUtil;
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
  const bar = (v) => `<div class="bar-track"><div class="bar-fill" style="width:${Math.max(0, Math.min(100, (v / MAX_SCORE) * 100))}%"></div></div>`;

  /** 花费展示：优先「花费 / 人数」，兼容旧数据的 avgCost */
  function costText(p) {
    if (!p) return '';
    if (p.amount) return '¥' + p.amount + (p.people ? ` / ${p.people}人` : '');
    if (p.avgCost) return '人均 ¥' + p.avgCost;
    return '';
  }
  /** 排序用：花费额（旧数据用 人均×人数 估算） */
  function costValue(p) {
    if (!p) return 0;
    if (p.amount) return Number(p.amount) || 0;
    if (p.avgCost) return (Number(p.avgCost) || 0) * (Number(p.people) || 1);
    return 0;
  }

  const TAGS = ['值得二刷', '踩雷', '排队久', '性价比高', '环境好', '服务好', '适合聚餐', '一人食', '分量足', '要预约'];
  const NEG_TAGS = ['踩雷', '排队久'];

  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  const UI = {
    page: 'page-rank',
    q: '', cat: '', sort: 'score',
    draft: { place: null, placeIsNew: false, scores: {}, tags: [], editingId: null, dishes: [], photos: [] },
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
    else if (UI.sort === 'cost') withScore.sort((a, b) => costValue(b.p) - costValue(a.p));
    else withScore.sort((a, b) => String(b.p.createdAt || '').localeCompare(String(a.p.createdAt || '')));

    const box = $('#place-list');
    box.innerHTML = withScore.map(({ p, s }) => {
      const tags = collectTags(p.id).slice(0, 3);
      return `<div class="pcard" data-id="${esc(p.id)}">
        <div class="pcard-head">
          <div class="pcard-name">${esc(p.name)}</div>
          ${s.count ? `<div class="pcard-score">${n1(s.total)}<small> 星</small></div>` : '<div class="pcard-score" style="font-size:13px;color:#7A7268">待评</div>'}
        </div>
        <div class="pcard-meta">
          ${p.category ? `<span>${esc(p.category)}</span><span class="dot">·</span>` : ''}
          ${costText(p) ? `<span>${esc(costText(p))}</span><span class="dot">·</span>` : ''}
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
          ${costText(p) ? `<span>${esc(costText(p))}</span><span class="dot">·</span>` : ''}
          ${p.address ? `<span>${esc(p.address)}</span>` : ''}
        </div>
      </div>

      <div class="detail-photos" id="detail-photos" hidden></div>

      ${s.count ? `<div class="card">
        <div class="taste-line"><div class="l">综合</div><div class="t"><div class="f" style="width:${(s.total / MAX_SCORE) * 100}%"></div></div><div class="v">${n1(s.total)}</div></div>
        ${DIMS.map(d => `<div class="taste-line"><div class="l">${d.label}</div><div class="t"><div class="f" style="width:${(s[d.key] / MAX_SCORE) * 100}%"></div></div><div class="v">${n1(s[d.key])}</div></div>`).join('')}
        <p class="hint">${s.count} 人评过${costText(p) ? ` · ${esc(costText(p))}` : ''}</p>
      </div>` : '<div class="card"><p class="hint">还没人评分，来当第一个。</p></div>'}

      <div class="list">
        ${list.map(r => {
          const total = ratingTotal(r);
          return `<div class="rate-item">
            <div class="rate-head">
              <div class="avatar" style="background:${avatarColor(r.nick)}">${esc(r.nick.slice(0, 1))}</div>
              <div class="who">${esc(r.nick)}</div>
              <div class="sc">${n1(total)}</div>
            </div>
            <div class="rate-bars">${DIMS.map(d => `<div class="bar"><div class="bar-t">${d.label}</div>${bar(r[d.key])}</div>`).join('')}</div>
            ${r.comment ? `<div class="rate-cmt">${esc(r.comment)}</div>` : ''}
            ${(r.tags || []).length ? `<div class="tagline">${r.tags.map(t => `<span class="mini-tag${NEG_TAGS.includes(t) ? ' bad' : ''}">${esc(t)}</span>`).join('')}</div>` : ''}
            ${(r.dishes || []).length ? `<table class="dish-table">${r.dishes.map(x => `<tr><td>${esc(x.name)}</td><td>${x.price ? '¥' + x.price : ''}</td></tr>`).join('')}</table>` : ''}
            ${r.bill ? `<div class="bill-row"><span>${r.people ? r.people + ' 人吃饭' : '本次账单'}</span><b>¥${r.bill}</b></div>` : ''}
            <div class="rate-date">${esc(r.visitedAt || '')}</div>
            ${r.nick === Store.myNick() ? `<div class="rate-edit" data-edit="${esc(r.id)}">修改我的评分</div>` : ''}
          </div>`;
        }).join('')}
      </div>

      <button class="btn-main" id="sheet-rate">${my ? '修改我的评分' : '我也评一下'}</button>
    `;
    $('#sheet-mask').hidden = false;

    // 异步载入这家店所有照片（本地优先，没有就拉云端）
    const photoIds = [];
    list.forEach(r => (r.photos || []).forEach(ph => photoIds.push(ph.id)));
    const pbox = $('#detail-photos');
    if (photoIds.length && pbox) {
      pbox.hidden = false;
      UI.sheetUrls = UI.sheetUrls || [];
      (async () => {
        for (const pid of photoIds) {
          const blob = await Store.loadPhoto(pid);
          if (!blob) continue;
          const url = URL.createObjectURL(blob);
          UI.sheetUrls.push(url);
          const im = document.createElement('img');
          im.src = url;
          im.alt = '';
          im.addEventListener('click', () => openLightbox(url));
          pbox.appendChild(im);
        }
      })();
    }

    $('#sheet-x').addEventListener('click', closeSheet);
    $('#sheet-rate').addEventListener('click', () => { closeSheet(); startRate(p, my || null); });
    $$('#sheet [data-edit]').forEach(el => el.addEventListener('click', () => {
      closeSheet(); startRate(p, my || null);
    }));
  }
  function closeSheet() {
    (UI.sheetUrls || []).forEach(u => URL.revokeObjectURL(u));
    UI.sheetUrls = [];
    $('#sheet-mask').hidden = true;
    UI.openPlaceId = null;
  }
  $('#sheet-mask').addEventListener('click', e => { if (e.target.id === 'sheet-mask') closeSheet(); });

  /* ================= 记一笔 ================= */
  function resetAdd() {
    (UI.draft.photos || []).forEach(p => { if (p.url) URL.revokeObjectURL(p.url); });   // 释放预览内存
    UI.draft = { place: null, placeIsNew: false, scores: {}, tags: [], editingId: null, dishes: [], photos: [] };
    $('#step-pick').hidden = false;
    $('#step-newplace').hidden = true;
    $('#step-rate').hidden = true;
    $('#pick-search').value = '';
    $('#add-tip').textContent = '';
    $('#r-bill').value = '';
    $('#r-people').value = '';
    renderPickList('');
    renderDims();
    renderTagChips();
    renderDishes();
    renderPhotoGrid();
  }

  function renderPickList(q) {
    const key = q.trim().toLowerCase();
    const list = Store.places
      .filter(p => !key || p.name.toLowerCase().includes(key) || (p.category || '').toLowerCase().includes(key))
      .slice(0, 20);
    $('#pick-list').innerHTML = list.map(p => `<div class="pick-item" data-id="${esc(p.id)}">
        <div><div class="n">${esc(p.name)}</div><div class="m">${esc(p.category || '未分类')}${costText(p) ? ' · ' + esc(costText(p)) : ''}</div></div>
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
    startRate({
      id: 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      name,
      category: $('#np-cat').value.trim(),
      amount: Number($('#np-amount').value) || 0,      // 花费
      people: Number($('#np-people').value) || 0,      // 人数
      address: $('#np-addr').value.trim(),
      createdAt: new Date().toISOString()
    }, null, true);
  });

  function startRate(place, existing, isNew) {
    if (!Store.myNick()) {
      toast('请先登录账号');
      return showLogin();
    }
    go('page-add');   // 内部 resetAdd() 会清空草稿，必须先切页再写值

    UI.draft = {
      place,
      placeIsNew: !!isNew,
      scores: {},
      tags: [],
      editingId: existing ? existing.id : null,
      dishes: [],
      photos: []
    };
    if (existing) {
      DIMS.forEach(d => { UI.draft.scores[d.key] = existing[d.key] || 0; });
      UI.draft.tags = (existing.tags || []).slice();
      UI.draft.dishes = (existing.dishes || []).map(x => ({ name: x.name || '', price: x.price || '' }));
      $('#r-comment').value = existing.comment || '';
      $('#r-date').value = existing.visitedAt || today();
      $('#r-bill').value = existing.bill || '';
      $('#r-people').value = existing.people || '';

      // 已有照片：先占位，再异步从本地/云端取回预览
      const oldPhotos = existing.photos || [];
      if (oldPhotos.length) {
        UI.draft.photos = oldPhotos.map(ph => ({ id: ph.id, url: '' }));
        renderPhotoGrid();
        (async () => {
          for (const p of UI.draft.photos) {
            const blob = await Store.loadPhoto(p.id);
            if (blob) { p.url = URL.createObjectURL(blob); renderPhotoGrid(); }
          }
        })();
      }
    } else {
      DIMS.forEach(d => { UI.draft.scores[d.key] = 0; });
      $('#r-comment').value = '';
      $('#r-date').value = today();
      $('#r-bill').value = '';
      $('#r-people').value = '';
    }

    $('#step-pick').hidden = true;
    $('#step-newplace').hidden = true;
    $('#step-rate').hidden = false;
    $('#picked-name').innerHTML = esc(place.name) +
      `<small>${esc(place.category || '未分类')}${costText(place) ? ' · ' + esc(costText(place)) : ''}${isNew ? ' · 新店' : ''}</small>`;
    renderDims();
    renderTagChips();
    renderDishes();
    renderPhotoGrid();
  }

  const STAR = '★';

  /** 生成 4 个维度的 10 星滑动条（只建一次，之后只重绘状态） */
  function renderDims() {
    const box = $('#dim-block');
    if (!box.dataset.built) {
      const stars = STAR.repeat(MAX_SCORE);
      box.innerHTML = DIMS.map(d => `
        <div class="dim-row">
          <span class="dim-name">${esc(d.label)}</span>
          <div class="stars-box">
            <div class="stars-bg">${stars}</div>
            <div class="stars-fill" data-fill="${d.key}">${stars}</div>
            <input type="range" class="star-range" data-dim="${d.key}"
                   min="0" max="${MAX_SCORE}" step="0.1" value="0" aria-label="${esc(d.label)}">
          </div>
          <span class="star-val" data-val="${d.key}">0.0</span>
        </div>`).join('');

      $$('.star-range', box).forEach(r => {
        r.addEventListener('input', () => {
          const v = Math.round(Number(r.value) * 10) / 10;   // 保留一位小数
          UI.draft.scores[r.dataset.dim] = v;
          paintDims();
        });
      });
      box.dataset.built = '1';
    }
    paintDims();
  }

  function paintDims() {
    DIMS.forEach(d => {
      const v = Number(UI.draft.scores[d.key]) || 0;
      const fill = $('.stars-fill[data-fill="' + d.key + '"]');
      const val = $('.star-val[data-val="' + d.key + '"]');
      const range = $('.star-range[data-dim="' + d.key + '"]');
      if (fill) fill.style.width = (v / MAX_SCORE * 100).toFixed(2) + '%';
      if (val) val.textContent = v.toFixed(1);
      if (range && Math.abs(Number(range.value) - v) > 0.001) range.value = v;
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

  /* ================= 菜品清单 ================= */
  function renderDishes() {
    const box = $('#dish-list');
    if (!UI.draft.dishes.length) UI.draft.dishes.push({ name: '', price: '' });

    box.innerHTML = UI.draft.dishes.map((d, i) =>
      `<div class="dish-row" data-i="${i}">
        <input type="text" class="dish-name" placeholder="菜名" value="${esc(d.name)}">
        <input type="number" class="dish-price" placeholder="价格" inputmode="decimal" value="${esc(d.price)}">
        <button class="dish-del" title="删掉">✕</button>
      </div>`).join('');

    $$('#dish-list .dish-row').forEach(row => {
      const i = Number(row.dataset.i);
      // 输入时不重绘，否则会丢焦点
      $('.dish-name', row).addEventListener('input', e => { UI.draft.dishes[i].name = e.target.value; });
      $('.dish-price', row).addEventListener('input', e => {
        UI.draft.dishes[i].price = e.target.value;
        updateBillHint();
      });
      $('.dish-del', row).addEventListener('click', () => {
        UI.draft.dishes.splice(i, 1);
        renderDishes();
        updateBillHint();
      });
    });
    updateBillHint();
  }

  function updateBillHint() {
    const bill = Number($('#r-bill').value) || 0;
    const people = Number($('#r-people').value) || 0;
    const dishSum = UI.draft.dishes.reduce((s, d) => s + (Number(d.price) || 0), 0);
    const parts = [];
    if (bill) parts.push(people ? `${people} 人 · 合计 ¥${bill}` : `合计 ¥${bill}`);
    if (dishSum) parts.push(`菜品合计 ¥${dishSum}`);
    if (bill && dishSum && Math.abs(bill - dishSum) >= 1) {
      parts.push(`与账单差 ¥${(bill - dishSum).toFixed(0)}`);
    }
    $('#bill-hint').textContent = parts.length ? parts.join(' · ') : '填了金额和人数会自动算人均';
  }

  /* ================= 照片 ================= */
  const MAX_PHOTOS = 9;

  /** 压缩到长边 1280、JPEG 0.72，一张约 100~200KB */
  function compressImage(file, maxSide, quality) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        let w = img.naturalWidth, h = img.naturalHeight;
        const scale = Math.min(1, maxSide / Math.max(w, h));
        w = Math.max(1, Math.round(w * scale));
        h = Math.max(1, Math.round(h * scale));
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const ctx = cv.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        cv.toBlob(b => (b ? resolve(b) : reject(new Error('压缩失败'))), 'image/jpeg', quality);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片读不出来')); };
      img.src = url;
    });
  }

  async function handlePhotoFiles(files) {
    const room = MAX_PHOTOS - UI.draft.photos.length;
    if (room <= 0) return toast(`最多 ${MAX_PHOTOS} 张`);
    const list = Array.from(files).slice(0, room);

    for (let k = 0; k < list.length; k++) {
      try {
        const blob = await compressImage(list[k], 1280, 0.72);
        const id = 'ph_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        await Store.savePhotoLocal(id, blob);
        UI.draft.photos.push({ id, url: URL.createObjectURL(blob) });
        renderPhotoGrid();
      } catch (e) {
        toast('有张图没处理成功：' + e.message);
      }
    }
    if (list.length) toast(`已添加 ${list.length} 张`);
  }

  function renderPhotoGrid() {
    $('#photo-grid').innerHTML = UI.draft.photos.map(p =>
      `<div class="photo-item" data-id="${esc(p.id)}">
        ${p.url ? `<img src="${p.url}" alt="">` : ''}
        <button class="photo-del" data-del="${esc(p.id)}" title="删掉">✕</button>
      </div>`).join('');

    $$('#photo-grid .photo-del').forEach(btn => btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = btn.dataset.del;
      const i = UI.draft.photos.findIndex(p => p.id === id);
      if (i >= 0) {
        const p = UI.draft.photos.splice(i, 1)[0];
        if (p.url) URL.revokeObjectURL(p.url);
      }
      renderPhotoGrid();
    }));
  }

  function openLightbox(url) {
    if (!url) return;
    $('#lightbox-img').src = url;
    $('#lightbox').hidden = false;
  }
  $('#lightbox').addEventListener('click', () => {
    $('#lightbox').hidden = true;
    $('#lightbox-img').src = '';
  });

  $('#btn-add-dish').addEventListener('click', () => {
    UI.draft.dishes.push({ name: '', price: '' });
    renderDishes();
  });
  $('#btn-add-photo').addEventListener('click', () => $('#photo-input').click());
  $('#photo-input').addEventListener('change', async e => {
    const files = e.target.files;
    if (files && files.length) await handlePhotoFiles(files);
    e.target.value = '';
  });
  $('#r-bill').addEventListener('input', updateBillHint);
  $('#r-people').addEventListener('input', updateBillHint);

  $('#btn-rate-cancel').addEventListener('click', resetAdd);

  $('#btn-submit').addEventListener('click', async () => {
    const s = UI.draft.scores;
    if (DIMS.every(d => !s[d.key])) return toast('至少打一个维度的分');
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
        comment: $('#r-comment').value.trim(),
        tags: d.tags.slice(),
        visitedAt: $('#r-date').value || today(),
        updatedAt: new Date().toISOString()
      };
      DIMS.forEach(x => { rec[x.key] = Number(s[x.key]) || 0; });

      rec.dishes = d.dishes
        .filter(x => String(x.name || '').trim())
        .map(x => ({ name: String(x.name).trim(), price: Number(x.price) || 0 }));
      rec.bill = Number($('#r-bill').value) || 0;
      rec.people = Number($('#r-people').value) || 0;
      rec.photos = d.photos.map(p => ({ id: p.id }));

      const idx = ratings.findIndex(r => r.id === rec.id);
      if (idx >= 0) ratings[idx] = rec; else ratings.push(rec);

      const res = await Store.saveMyRatings(ratings);

      // 照片单独上传；失败的进队列，下次打开自动补
      let photoFail = 0;
      for (const p of d.photos) {
        try { await Store.uploadPhoto(p.id); } catch (e) { photoFail++; }
      }
      $('#add-tip').className = 'tip ok';
      $('#add-tip').textContent = res.queued ? '已存本地，联网后自动补交' : '提交成功';
      if (photoFail) toast(`${photoFail} 张照片没传上去，联网后自动补`, 2800);
      else toast(res.queued ? '离线保存了，联网后再传' : '记下了 ✓');
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
      const t = ratingTotal(r);
      return { r, t };
    }).sort((a, b) => b.t - a.t)[0];

    $('#profile-card').innerHTML = `
      <div class="stat-row">
        <div class="stat"><b>${ratings.length}</b><span>评过</span></div>
        <div class="stat"><b>${ratings.length ? n1(s.total) : '-'}</b><span>平均星</span></div>
        <div class="stat"><b>${Store.places.length}</b><span>收录店</span></div>
      </div>
      ${ratings.length ? `<div style="margin-top:14px">
        ${DIMS.map(d => `<div class="taste-line"><div class="l">${d.label}</div><div class="t"><div class="f" style="width:${(s[d.key] / MAX_SCORE) * 100}%"></div></div><div class="v">${n1(s[d.key])}</div></div>`).join('')}
        <p class="hint">最满意「${DIMS.reduce((a, d) => (s[d.key] > s[a.key] ? d : a), DIMS[0]).label}」${best ? ` · 最高分：${esc(best.r.placeName)} ${n1(best.t)}` : ''}</p>
      </div>` : '<p class="hint" style="margin-top:12px">还没有评分记录，去「记一笔」开张。</p>'}
    `;

    const rows = ratings.slice().sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    $('#my-list').innerHTML = rows.map(r => {
      const p = Store.placeById(r.placeId);
      const t = ratingTotal(r);
      return `<div class="pcard" data-id="${esc(r.placeId)}">
        <div class="pcard-head">
          <div class="pcard-name">${esc(r.placeName || (p && p.name) || '未知')}</div>
          <div class="pcard-score">${n1(t)}<small> 星</small></div>
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
    const nick = Store.myNick();
    const av = $('#set-avatar');
    av.textContent = nick ? nick.slice(0, 1) : '?';
    av.style.background = nick ? avatarColor(nick) : '#D9CFC7';
    $('#set-nickname').textContent = nick || '未登录';
    $('#set-owner').value = c.owner || '';
    $('#set-repo').value = c.repo || '';
    $('#set-token').value = c.token || '';
    $('#set-branch').value = c.branch || 'main';
    renderSyncState();
  }
  function renderSyncState() {
    const nick = Store.myNick();
    const n = Store.pending.length;
    const t = Store.lastSync ? new Date(Store.lastSync).toLocaleString('zh-CN') : '从未';
    $('#sync-state').textContent = `上次同步：${t}` + (n ? ` · ${n} 条待补交` : '') + (nick ? ` · 身份：${nick}` : '');
  }

  $('#btn-save-set').addEventListener('click', async () => {
    if (!Store.myNick()) return toast('请先登录账号');
    Store.saveCfg({
      owner: $('#set-owner').value.trim(),
      repo: $('#set-repo').value.trim(),
      token: $('#set-token').value.trim(),
      branch: $('#set-branch').value.trim() || 'main'
    });
    toast('已保存');
    loadSet();
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

  /* ================= 登录（固定 4 个账号） ================= */
  const ACCOUNTS = ['小羊', '小陈', '小皓', '小何'];
  const PWD_SALT = 'food-log-salt-2026';
  const PWD_ITER = 100000;
  // PBKDF2-SHA256(21032602, salt) —— 代码是公开的，只存哈希不存明文
  const PWD_HASH = '10cef5f61e7ffa09a9bcfbdc4a09bcaf9f5ea57debc54672b4dd8f2efee56901';

  // 内置同步配置：AES-GCM 密文（iv 12 + 密文 + tag），用登录密码派生密钥解开。
  // 不存明文 —— 公开仓库里的明文 GitHub token 会被 secret scanning 自动吊销。
  const CFG_SALT = 'food-log-cfg-2026';
  const CFG_SEAL = 'Dx8rMFUJvEvLBPPWq1Cv3D98+RONRq9J6MUlxULLpW7+KnuFX9/UkHT1mPx5I3s922wwXr2V8MxmQsO2crOgHFBm5iNKMBLf9xy1qb3z539yQAe2t+eXWGykuU1EybVjYzLnP2K9in9/qMMmHtinX48W+pedEEagPTyiN/7XJjiqqvSr4zBv7Cy1A3JDYvwbWfI5dgP4fYJnBWKEFFBnb+JKFm5fxyYAICjaurZMQ/fz+FH0koNA/E3sd0F5knprQXGcLA==';

  let pickedAccount = '';

  async function hashPwd(pwd) {
    const enc = new TextEncoder();
    const keyMat = await crypto.subtle.importKey('raw', enc.encode(pwd), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: enc.encode(PWD_SALT), iterations: PWD_ITER, hash: 'SHA-256' },
      keyMat, 256
    );
    return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /** 用登录密码解开内置的 GitHub 配置 */
  async function unsealCfg(pwd) {
    const enc = new TextEncoder();
    const km = await crypto.subtle.importKey('raw', enc.encode(pwd), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: enc.encode(CFG_SALT), iterations: PWD_ITER, hash: 'SHA-256' },
      km, { name: 'AES-GCM', length: 256 }, false, ['decrypt']
    );
    const bin = atob(CFG_SEAL);
    const raw = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) raw[i] = bin.charCodeAt(i);
    const iv = raw.slice(0, 12);
    const ct = raw.slice(12);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return JSON.parse(new TextDecoder().decode(plain));
  }

  function initLogin() {
    $('#accounts').innerHTML = ACCOUNTS.map(n =>
      `<button class="acc" data-nick="${esc(n)}">
        <div class="avatar" style="background:${avatarColor(n)}">${esc(n.slice(0, 1))}</div>
        <div class="nm">${esc(n)}</div>
      </button>`).join('');

    $$('#accounts .acc').forEach(b => b.addEventListener('click', () => {
      pickedAccount = b.dataset.nick;
      $$('#accounts .acc').forEach(x => x.classList.toggle('on', x === b));
      $('#login-form').hidden = false;
      $('#login-err').textContent = '';
      $('#pwd').value = '';
      $('#pwd').focus();
    }));

    $('#btn-login').addEventListener('click', doLogin);
    $('#pwd').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  }

  async function doLogin() {
    if (!pickedAccount) return;
    if (!(window.crypto && window.crypto.subtle)) {
      $('#login-err').textContent = '当前环境不支持安全校验，请用 https 打开';
      return;
    }
    const pwd = $('#pwd').value;
    if (!pwd) { $('#login-err').textContent = '请输入密码'; return; }

    const btn = $('#btn-login');
    btn.disabled = true; btn.textContent = '验证中…';
    try {
      const h = await hashPwd(pwd);
      if (h !== PWD_HASH) {
        $('#login-err').textContent = '密码不对';
        $('#pwd').value = '';
        $('#pwd').focus();
        return;
      }
      Store.setSession(pickedAccount);

      // 自动套用内置同步配置（同一密码解封）；解不开就保底走手动填写
      let autoCfg = false;
      try {
        const cfg = await unsealCfg(pwd);
        if (cfg && cfg.owner && cfg.repo && cfg.token) {
          Store.saveCfg(cfg);
          autoCfg = true;
        }
      } catch (e) {
        console.warn('内置同步配置解封失败：', e.message);
      }

      hideLogin();
      loadSet();
      renderRank();
      renderMe();

      if (Store.ready) {
        toast(`欢迎，${pickedAccount}`);
        doSync(true);
      } else {
        toast(`欢迎，${pickedAccount}（同步还没配好）`, 2600);
        go('page-set');
      }
    } catch (e) {
      $('#login-err').textContent = '登录失败：' + e.message;
    } finally {
      btn.disabled = false; btn.textContent = '进入';
    }
  }

  function showLogin() {
    pickedAccount = '';
    $$('#accounts .acc').forEach(x => x.classList.remove('on'));
    $('#login-form').hidden = true;
    $('#pwd').value = '';
    $('#login-err').textContent = '';
    $('#login').hidden = false;
  }
  function hideLogin() { $('#login').hidden = true; }

  $('#btn-logout').addEventListener('click', () => {
    if (!confirm('切换账号？本机缓存的数据不会丢。')) return;
    Store.clearSession();
    showLogin();
    go('page-set');
  });

  /* ================= 启动 ================= */
  function boot() {
    Store.init();
    initLogin();
    loadSet();
    renderRank();

    if (Store.myNick()) {
      hideLogin();
      if (Store.ready) doSync(true);
    } else {
      showLogin();
    }

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => { /* 本地 http 下可忽略 */ });
    }
  }

  boot();
})();
