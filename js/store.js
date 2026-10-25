/* 数据层：本地缓存 + GitHub 云同步 + 离线补交
 * 关键设计：每人一个独立数据文件 data/users/u_<hash>.json
 *   → 多人同时提交不会互相覆盖，只有「同一人两台设备同时提交」才可能冲突（已带 sha 重试）
 */
(function (global) {
  'use strict';

  const K = {
    cfg: 'foodlog:cfg',
    places: 'foodlog:places',
    users: 'foodlog:users',
    pending: 'foodlog:pending',
    syncedAt: 'foodlog:syncedAt'
  };

  const PLACES_PATH = 'data/places.json';
  const USERS_DIR = 'data/users';

  /* ---------- 工具 ---------- */
  function readLS(key, def) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : def;
    } catch (e) { return def; }
  }
  function writeLS(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { console.warn('缓存写入失败', e); }
  }

  /* ---------- 照片本地缓存（IndexedDB，localStorage 装不下图） ---------- */
  const IDB_NAME = 'foodlog-db';
  const IDB_STORE = 'photos';
  let idbPromise = null;

  function openIDB() {
    if (idbPromise) return idbPromise;
    idbPromise = new Promise((resolve, reject) => {
      if (!global.indexedDB) return reject(new Error('浏览器不支持 IndexedDB'));
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB 打开失败'));
    });
    return idbPromise;
  }

  function idbTx(mode, fn) {
    return openIDB().then(db => new Promise((res, rej) => {
      const tx = db.transaction(IDB_STORE, mode);
      let out;
      const req = fn(tx.objectStore(IDB_STORE));
      if (req) req.onsuccess = () => { out = req.result; };
      tx.oncomplete = () => res(out);
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error);
    }));
  }

  const idbPut = (k, v) => idbTx('readwrite', s => s.put(v, k));
  const idbGet = (k) => idbTx('readonly', s => s.get(k));
  const idbDel = (k) => idbTx('readwrite', s => s.delete(k));

  function bufToB64(buf) {
    const bytes = new Uint8Array(buf);
    let bin = '';
    const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return btoa(bin);
  }

  function b64ToBlob(b64, type) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: type || 'image/jpeg' });
  }

  /* ---------- 登录会话（首次登录后长期记住） ---------- */
  const SESSION_KEY = 'foodlog:session';
  function sessionNick() {
    try {
      const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      return s && s.nick ? String(s.nick) : '';
    } catch (e) { return ''; }
  }

  /** 昵称 → 稳定的 8 位文件名后缀（避免中文路径，也避免重名撞车） */
  function nickHash(nick) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    const s = String(nick || 'anon');
    for (let i = 0; i < s.length; i++) {
      const ch = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (((h2 >>> 0) * 4294967296 + (h1 >>> 0)) >>> 0).toString(16).padStart(8, '0').slice(-8);
  }

  const uid = (p) => p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const nowISO = () => new Date().toISOString();

  /* ---------- Store ---------- */
  const Store = {
    client: null,
    places: [],
    userFiles: {},   // { fileName: { nick, ratings:[] } }
    pending: [],
    lastSync: 0,

    init() {
      this.places = readLS(K.places, []);
      this.userFiles = readLS(K.users, {});
      this.pending = readLS(K.pending, []);
      this.lastSync = readLS(K.syncedAt, 0);
      const cfg = this.cfg();
      this.client = new GitHubClient(cfg);
      return this;
    },

    cfg() { return readLS(K.cfg, { nick: '', owner: '', repo: '', token: '', branch: 'main' }); },
    saveCfg(cfg) {
      const merged = Object.assign(this.cfg(), cfg);
      writeLS(K.cfg, merged);
      this.client = new GitHubClient(merged);
      return merged;
    },
    get ready() { return this.client && this.client.ready && !!this.myNick(); },

    /* ---------- 本地缓存 ---------- */
    _persist() {
      writeLS(K.places, this.places);
      writeLS(K.users, this.userFiles);
      writeLS(K.pending, this.pending);
    },

    /* ---------- 拉取云端 ---------- */
    async pull() {
      if (!this.client || !this.client.ready) return { ok: false, reason: '未配置' };
      const t0 = Date.now();

      const [placesFile, dir] = await Promise.all([
        this.client.getFile(PLACES_PATH),
        this.client.listDir(USERS_DIR)
      ]);

      if (placesFile && Array.isArray(placesFile.data && placesFile.data.places)) {
        this.places = mergePlaces(this.places, placesFile.data.places);
      }

      const files = dir.filter(f => f.type === 'file' && /^u_.*\.json$/.test(f.name));
      // 人数不会多，逐个串行读，避免一次性打完接口
      for (const f of files) {
        try {
          const r = await this.client.getFile(`${USERS_DIR}/${f.name}`);
          if (r && r.data) {
            this.userFiles[f.name] = {
              nick: r.data.nick || f.name,
              ratings: Array.isArray(r.data.ratings) ? r.data.ratings : []
            };
          }
        } catch (e) { console.warn('读取用户数据失败', f.name, e.message); }
      }

      this.lastSync = t0;
      writeLS(K.syncedAt, t0);
      this._persist();
      return { ok: true, places: this.places.length, users: Object.keys(this.userFiles).length };
    },

    /** 拉完云端后把本地没交上去的补交 */
    async flush() {
      if (!this.ready || this.pending.length === 0) return 0;
      let done = 0;
      const remain = [];
      for (const op of this.pending) {
        try {
          await this._runOp(op);
          done++;
        } catch (e) {
          console.warn('补交失败，保留队列', op.type, e.message);
          remain.push(op);
        }
      }
      this.pending = remain;
      this._persist();
      return done;
    },

    async _runOp(op) {
      if (op.type === 'place') {
        await this.client.putFile(
          PLACES_PATH,
          { v: 1, places: [op.place] },
          `新增店铺：${op.place.name}`,
          (remote, local) => mergePlacesToFile(remote, local.places)
        );
        this.places = mergePlaces(this.places, [op.place]);
      } else if (op.type === 'ratings') {
        const nick = op.nick;
        const fileName = `u_${nickHash(nick)}.json`;
        await this.client.putFile(
          `${USERS_DIR}/${fileName}`,
          { nick, ratings: op.ratings },
          `更新 ${nick} 的评分`,
          (remote, local) => mergeRatingsFile(remote, local.ratings, nick)
        );
        this.userFiles[fileName] = { nick, ratings: op.ratings };
      } else if (op.type === 'photo') {
        const blob = await this.getPhotoLocal(op.photoId);
        if (!blob) return;                      // 本地也找不到，只能放弃
        const b64 = bufToB64(await blob.arrayBuffer());
        await this.client.putBase64(`data/photos/${op.photoId}.jpg`, b64, `照片 ${op.photoId}`);
      }
      this._persist();
    },

    /* ---------- 写入（离线优先） ---------- */
    async addPlace(place) {
      place.id = place.id || uid('p');
      place.createdAt = place.createdAt || nowISO();
      this.places = mergePlaces(this.places, [place]);
      this._persist();
      if (!this.ready) { queuePlace(this, place); return { queued: true }; }
      try {
        await this._runOp({ type: 'place', place });
        return { ok: true };
      } catch (e) {
        queuePlace(this, place);
        throw e;
      }
    },

    async saveMyRatings(ratings) {
      const nick = this.myNick();
      const fileName = `u_${nickHash(nick)}.json`;
      this.userFiles[fileName] = { nick, ratings };
      this._persist();
      if (!this.ready) { queueRatings(this, nick, ratings); return { queued: true }; }
      try {
        await this._runOp({ type: 'ratings', nick, ratings });
        return { ok: true };
      } catch (e) {
        queueRatings(this, nick, ratings);
        throw e;
      }
    },

    /* ---------- 照片 ---------- */
    async savePhotoLocal(photoId, blob) {
      try { await idbPut(photoId, blob); return true; }
      catch (e) { console.warn('本地存图失败', e.message); return false; }
    },
    async getPhotoLocal(photoId) {
      try { return await idbGet(photoId); } catch (e) { return null; }
    },
    async removePhotoLocal(photoId) {
      try { await idbDel(photoId); } catch (e) { /* ignore */ }
    },
    /** 上传单张照片；离线或失败则入队，下次自动补 */
    async uploadPhoto(photoId) {
      if (!this.ready) { queuePhoto(this, photoId); return { queued: true }; }
      try {
        await this._runOp({ type: 'photo', photoId });
        return { ok: true };
      } catch (e) {
        queuePhoto(this, photoId);
        throw e;
      }
    },
    /** 取照片：本地优先，没有再拉云端并缓存到本地 */
    async loadPhoto(photoId) {
      const local = await this.getPhotoLocal(photoId);
      if (local) return local;
      if (!this.client || !this.client.ready) return null;
      try {
        const b64 = await this.client.getRawBase64(`data/photos/${photoId}.jpg`);
        if (!b64) return null;
        const blob = b64ToBlob(b64);
        await idbPut(photoId, blob);
        return blob;
      } catch (e) {
        console.warn('拉取照片失败', photoId, e.message);
        return null;
      }
    },

    /* ---------- 查询 ---------- */
    myNick() { return sessionNick(); },
    setSession(nick) { writeLS(SESSION_KEY, { nick, at: Date.now() }); },
    clearSession() { try { localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ } },
    myRatings() {
      const nick = this.myNick();
      const f = this.userFiles[`u_${nickHash(nick)}.json`];
      return f ? f.ratings : [];
    },
    allMembers() {
      return Object.values(this.userFiles).map(f => f.nick).sort();
    },
    /** 某店铺的所有人评分 */
    ratingsOf(placeId) {
      const out = [];
      Object.values(this.userFiles).forEach(f => {
        f.ratings.forEach(r => { if (r.placeId === placeId) out.push(Object.assign({ nick: f.nick }, r)); });
      });
      return out.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    },
    placeById(id) { return this.places.find(p => p.id === id) || null; },
    categories() {
      return Array.from(new Set(this.places.map(p => p.category).filter(Boolean))).sort();
    },

    /* ---------- 备份 ---------- */
    exportAll() {
      return { v: 1, exportedAt: nowISO(), places: this.places, userFiles: this.userFiles };
    },
    importAll(obj) {
      if (!obj || !Array.isArray(obj.places)) throw new Error('文件格式不对');
      this.places = mergePlaces(this.places, obj.places);
      if (obj.userFiles) {
        Object.entries(obj.userFiles).forEach(([k, v]) => {
          const prev = this.userFiles[k];
          this.userFiles[k] = {
            nick: v.nick || (prev && prev.nick) || k,
            ratings: mergeRatings(prev ? prev.ratings : [], v.ratings || [])
          };
        });
      }
      this._persist();
    }
  };

  /* ---------- 合并逻辑：按 id 去重，取更新时间更晚的 ---------- */
  function mergePlaces(local, remote) {
    const map = new Map();
    (local || []).forEach(p => p && p.id && map.set(p.id, p));
    (remote || []).forEach(p => {
      if (!p || !p.id) return;
      const cur = map.get(p.id);
      if (!cur || String(p.updatedAt || p.createdAt || '') >= String(cur.updatedAt || cur.createdAt || '')) {
        map.set(p.id, p);
      }
    });
    return Array.from(map.values());
  }

  function mergePlacesToFile(remoteFile, localPlaces) {
    const base = (remoteFile && Array.isArray(remoteFile.places)) ? remoteFile.places : [];
    return { v: 1, places: mergePlaces(base, localPlaces) };
  }

  function mergeRatings(local, remote) {
    const map = new Map();
    (local || []).forEach(r => r && r.id && map.set(r.id, r));
    (remote || []).forEach(r => {
      if (!r || !r.id) return;
      const cur = map.get(r.id);
      if (!cur || String(r.updatedAt || '') >= String(cur.updatedAt || '')) map.set(r.id, r);
    });
    return Array.from(map.values());
  }

  function mergeRatingsFile(remoteFile, localRatings, nick) {
    const base = (remoteFile && Array.isArray(remoteFile.ratings)) ? remoteFile.ratings : [];
    return { nick, ratings: mergeRatings(base, localRatings) };
  }

  /* ---------- 离线队列 ---------- */
  function queuePlace(store, place) {
    store.pending = store.pending.filter(o => !(o.type === 'place' && o.place.id === place.id));
    store.pending.push({ type: 'place', place });
    store._persist();
  }
  function queueRatings(store, nick, ratings) {
    store.pending = store.pending.filter(o => !(o.type === 'ratings' && o.nick === nick));
    store.pending.push({ type: 'ratings', nick, ratings });
    store._persist();
  }
  function queuePhoto(store, photoId) {
    store.pending = store.pending.filter(o => !(o.type === 'photo' && o.photoId === photoId));
    store.pending.push({ type: 'photo', photoId });
    store._persist();
  }

  /* ---------- 计算 ---------- */
  const MAX_SCORE = 10;

  // 全部同向：分越高越好（「价格」= 越实惠分越高）
  const DIMS = [
    { key: 'taste', label: '味道' },
    { key: 'env', label: '环境' },
    { key: 'service', label: '服务' },
    { key: 'price', label: '价格', hint: '越实惠越高' },
    { key: 'hygiene', label: '卫生' },
    { key: 'speed', label: '等位', hint: '越快越高' }
  ];

  /** 单条评分：只对填了的维度求平均 */
  function ratingTotal(r) {
    const vals = DIMS.map(d => Number(r[d.key]) || 0).filter(v => v > 0);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  }

  /** 汇总某店铺的所有评分：各维度平均 + 综合平均 */
  function summarize(ratings) {
    const out = { count: ratings.length, total: 0 };
    DIMS.forEach(d => { out[d.key] = 0; });
    if (!ratings.length) return out;

    DIMS.forEach(d => {
      const arr = ratings.map(r => Number(r[d.key]) || 0).filter(v => v > 0);
      out[d.key] = arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    });
    // 综合分：只把「有评分」的维度纳入平均，避免空缺维度拉低总分
    const valid = DIMS.map(d => out[d.key]).filter(v => v > 0);
    out.total = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : 0;
    return out;
  }

  const AVATAR_COLORS = ['#4A90D9', '#E85520', '#2FA36B', '#9B59B6', '#E67E22', '#16A085', '#C94F7C', '#5D6D7E'];
  function avatarColor(nick) {
    let h = 0;
    for (let i = 0; i < String(nick).length; i++) h = (h * 31 + String(nick).charCodeAt(i)) >>> 0;
    return AVATAR_COLORS[h % AVATAR_COLORS.length];
  }

  global.Store = Store;
  global.FoodUtil = { DIMS, MAX_SCORE, summarize, ratingTotal, avatarColor, nickHash, uid, nowISO };
})(window);
