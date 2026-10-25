/* GitHub Contents API 封装 —— 纯前端直连，无需自建服务器
 * 已验证 api.github.com 返回 Access-Control-Allow-Origin: * 且 Allow-Headers 含 Authorization
 * 与 Gitee 的差异：token 必须走 Authorization 头（不支持 query），写文件用 PUT
 */
(function (global) {
  'use strict';

  const API = 'https://api.github.com';
  const UA = 'food-log-pwa';

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

  class RemoteError extends Error {
    constructor(message, status, body) {
      super(message);
      this.name = 'RemoteError';
      this.status = status;
      this.body = body;
    }
  }

  class GitHubClient {
    constructor(cfg) {
      this.setConfig(cfg || {});
    }

    setConfig({ owner, repo, token, branch }) {
      this.owner = (owner || '').trim();
      this.repo = (repo || '').trim();
      this.token = (token || '').trim();
      this.branch = (branch || 'main').trim() || 'main';
    }

    get ready() {
      return !!(this.owner && this.repo && this.token);
    }

    async request(method, path, body) {
      let url = `${API}/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/contents/${path}`;
      if (method === 'GET') url += '?ref=' + encodeURIComponent(this.branch);

      const init = {
        method,
        headers: {
          'Authorization': 'Bearer ' + this.token,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28'
        }
      };
      if (body) {
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
      }

      let res;
      try {
        res = await fetch(url, init);
      } catch (e) {
        throw new RemoteError('网络连不上 GitHub，检查网络后重试', 0, null);
      }

      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch (e) { /* 非 JSON */ }

      if (!res.ok) {
        let msg = (data && (data.message || data.error)) || `请求失败 (${res.status})`;
        if (res.status === 401) msg = '令牌无效或已过期';
        if (res.status === 403) {
          const remain = res.headers.get('X-RateLimit-Remaining');
          msg = remain === '0' ? '触发 GitHub 限流，请稍后再试' : '令牌没有该仓库的写入权限';
        }
        if (res.status === 404) msg = '仓库不存在或令牌无权访问';
        throw new RemoteError(msg, res.status, data);
      }
      return data;
    }

    static encodePath(p) {
      return String(p).split('/').map(encodeURIComponent).join('/');
    }

    /** 读文件。不存在返回 null */
    async getFile(path) {
      try {
        const d = await this.request('GET', GitHubClient.encodePath(path));
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
        const d = await this.request('GET', GitHubClient.encodePath(path));
        return Array.isArray(d) ? d : [];
      } catch (e) {
        if (e.status === 404) return [];
        throw e;
      }
    }

    /** 直接写 base64 内容（图片等二进制），不走 JSON 序列化 */
    async putBase64(path, b64, message, retries = 2) {
      const enc = GitHubClient.encodePath(path);
      let attempt = 0;
      while (attempt <= retries) {
        let sha = null;
        try {
          const d = await this.request('GET', enc);
          if (d && d.sha) sha = d.sha;
        } catch (e) { if (e.status !== 404) throw e; }

        try {
          const body = { message: message || 'upload', content: b64, branch: this.branch };
          if (sha) body.sha = sha;
          await this.request('PUT', enc, body);
          return true;
        } catch (e) {
          const retryable = e.status === 409 || e.status === 422 || e.status === 400;
          if (retryable && attempt < retries) { attempt++; continue; }
          throw e;
        }
      }
      throw new RemoteError('照片上传重试失败', 0, null);
    }

    /** 读原始 base64（图片），不存在返回 null */
    async getRawBase64(path) {
      const enc = GitHubClient.encodePath(path);
      try {
        const d = await this.request('GET', enc);
        return d && d.content ? String(d.content).replace(/\s/g, '') : null;
      } catch (e) {
        if (e.status === 404) return null;
        throw e;
      }
    }

    /** 校验仓库本身可访问（设置页「测试连接」用，能区分仓库不存在 / 令牌无效） */
    async checkRepo() {
      const url = `${API}/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}`;
      let res;
      try {
        res = await fetch(url, {
          headers: {
            'Authorization': 'Bearer ' + this.token,
            'Accept': 'application/vnd.github+json'
          }
        });
      } catch (e) {
        throw new RemoteError('网络连不上 GitHub', 0, null);
      }
      if (res.status === 401) throw new RemoteError('令牌无效或已过期', 401, null);
      if (res.status === 404) throw new RemoteError('仓库不存在，或令牌无权访问该仓库', 404, null);
      if (!res.ok) throw new RemoteError('请求失败 (' + res.status + ')', res.status, null);
      const d = await res.json();
      return { full_name: d.full_name, isPrivate: d.private, defaultBranch: d.default_branch };
    }

    /**
     * 写文件（新建或更新），sha 冲突自动重试。
     * @param merge 冲突时合并：(远端最新数据, 本地待写数据) => 合并结果
     */
    async putFile(path, dataObj, message, merge, retries = 3) {
      const enc = GitHubClient.encodePath(path);
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
            message: message || 'update data',
            content: b64encode(JSON.stringify(payload, null, 2)),
            branch: this.branch
          };
          if (sha) body.sha = sha;
          await this.request('PUT', enc, body);
          return payload;
        } catch (e) {
          // sha 过期（409）或文件已存在（422）→ 拉最新重来
          const retryable = e.status === 409 || e.status === 422 || e.status === 400;
          if (retryable && attempt < retries) {
            attempt++;
            await new Promise(r => setTimeout(r, 220 * attempt));
            continue;
          }
          throw e;
        }
      }
      throw new RemoteError('写入重试多次仍失败', 0, null);
    }
  }

  global.GitHubClient = GitHubClient;
  global.RemoteError = RemoteError;
  global.__b64 = { encode: b64encode, decode: b64decode };
})(window);
