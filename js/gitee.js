/* Gitee Contents API 封装 —— 纯前端直连，无需自建服务器
 * 已验证：gitee.com/api/v5 返回 Access-Control-Allow-Origin: *，浏览器可跨域调用
 */
(function (global) {
  'use strict';

  const API = 'https://gitee.com/api/v5';

  /* ---------- UTF-8 安全的 base64 ---------- */
  function b64encode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function b64decode(b64) {
    const clean = String(b64).replace(/\s/g, '');
    const bin = atob(clean);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  class GiteeError extends Error {
    constructor(message, status, body) {
      super(message);
      this.name = 'GiteeError';
      this.status = status;
      this.body = body;
    }
  }

  class GiteeClient {
    constructor(cfg) {
      this.setConfig(cfg || {});
    }

    setConfig({ owner, repo, token, branch }) {
      this.owner = (owner || '').trim();
      this.repo = (repo || '').trim();
      this.token = (token || '').trim();
      this.branch = (branch || 'master').trim() || 'master';
    }

    get ready() {
      return !!(this.owner && this.repo && this.token);
    }

    async request(method, path, { query, body } = {}) {
      let url = `${API}/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/contents/${path}`;
      const qs = new URLSearchParams();
      if (query) Object.entries(query).forEach(([k, v]) => v != null && qs.set(k, v));
      // GET 只能把 token 放 query；写操作放 body，避免进访问日志
      if (method === 'GET') { qs.set('access_token', this.token); qs.set('ref', this.branch); }
      const s = qs.toString();
      if (s) url += '?' + s;

      const init = { method, headers: {} };
      if (body) {
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(Object.assign({ access_token: this.token, branch: this.branch }, body));
      }

      let res;
      try {
        res = await fetch(url, init);
      } catch (e) {
        throw new GiteeError('网络连不上 Gitee，检查网络后重试', 0, null);
      }

      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch (e) { /* 非 JSON */ }

      if (!res.ok) {
        const msg = (data && (data.message || data.error)) || `请求失败 (${res.status})`;
        throw new GiteeError(msg, res.status, data);
      }
      return data;
    }

    static encodePath(p) {
      return String(p).split('/').map(encodeURIComponent).join('/');
    }

    /** 读文件。不存在返回 null */
    async getFile(path) {
      try {
        const d = await this.request('GET', GiteeClient.encodePath(path));
        if (!d || d.type !== 'file') return null;
        return { sha: d.sha, data: JSON.parse(b64decode(d.content)) };
      } catch (e) {
        if (e.status === 404) return null;
        throw e;
      }
    }

    /** 列目录。不存在返回 [] */
    async listDir(path) {
      try {
        const d = await this.request('GET', GiteeClient.encodePath(path));
        return Array.isArray(d) ? d : [];
      } catch (e) {
        if (e.status === 404) return [];
        throw e;
      }
    }

    /**
     * 写文件（新建或更新），内置 sha 冲突自动重试。
     * @param path 路径
     * @param dataObj 要写入的对象
     * @param message commit 信息
     * @param merge 冲突时的合并回调 (远端最新数据, 本地待写数据) => 合并结果
     * @param retries 重试次数
     */
    async putFile(path, dataObj, message, merge, retries = 3) {
      const enc = GiteeClient.encodePath(path);
      let attempt = 0;
      let payload = dataObj;

      while (attempt <= retries) {
        let sha = null;
        let remote = null;
        try {
          remote = await this.getFile(path);
          sha = remote && remote.sha;
        } catch (e) { /* 读不到就当新建 */ }

        if (remote && sha && merge) {
          payload = merge(remote.data, dataObj);
        }

        try {
          const body = {
            content: b64encode(JSON.stringify(payload, null, 2)),
            message
          };
          if (sha) body.sha = sha;
          await this.request('POST', enc, { body });
          return payload;
        } catch (e) {
          // sha 过期 / 文件已存在 → 拉最新重来
          const retryable = e.status === 400 || e.status === 409 || e.status === 422;
          if (retryable && attempt < retries) {
            attempt++;
            await new Promise(r => setTimeout(r, 220 * attempt));
            continue;
          }
          throw e;
        }
      }
      throw new GiteeError('写入重试多次仍失败', 0, null);
    }
  }

  global.GiteeClient = GiteeClient;
  global.GiteeError = GiteeError;
  global.__b64 = { encode: b64encode, decode: b64decode };
})(window);
