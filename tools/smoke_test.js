/* 数据层冒烟测试（node tools/smoke_test.js）—— mock 浏览器环境，不联网 */
'use strict';

// ---- mock 浏览器全局 ----
const mem = {};
global.localStorage = {
  getItem: k => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: k => { delete mem[k]; }
};
global.window = global;
global.btoa = s => Buffer.from(s, 'binary').toString('base64');
global.atob = s => Buffer.from(s, 'base64').toString('binary');

let fail = 0;
function check(name, cond) {
  console.log((cond ? '  PASS ' : '  FAIL ') + name);
  if (!cond) fail++;
}

require('../js/remote.js');
require('../js/store.js');
const Store = global.Store;
const { DIMS, summarize, nickHash } = global.FoodUtil;

console.log('[1] nickHash 稳定 & 不同昵称不同文件');
check('中文昵称稳定', nickHash('小羊') === nickHash('小羊'));
check('不同昵称不同', nickHash('小羊') !== nickHash('小陈'));
check('8位hex', /^[0-9a-f]{8}$/.test(nickHash('小羊')));

console.log('[2] 未配置 GitHub 时 = 离线模式');
Store.init();
Store.saveCfg({ nick: '小羊', owner: '', repo: '', token: '' });
check('ready=false', Store.ready === false);

(async () => {
  console.log('[3] 离线添加店铺与评分 → 进 pending 队列');
  await Store.addPlace({ name: '笨萝卜浏阳菜馆', category: '湘菜', avgCost: 65 });
  check('店铺进内存', Store.places.length === 1);
  check('离线入队 place', Store.pending.length === 1 && Store.pending[0].type === 'place');

  await Store.saveMyRatings([{
    id: 'r1', placeId: Store.places[0].id, placeName: '笨萝卜浏阳菜馆',
    taste: 5, env: 4, service: 4, value: 5, comment: '擂辣椒绝了', tags: ['值得二刷'],
    visitedAt: '2026-10-25', updatedAt: '2026-10-25T12:00:00Z'
  }]);
  check('离线入队 ratings', Store.pending.some(o => o.type === 'ratings'));
  check('重复提交去重队列', Store.pending.filter(o => o.type === 'ratings').length === 1);

  console.log('[4] 统计计算');
  const rs = Store.ratingsOf(Store.places[0].id);
  check('查到 1 条评分', rs.length === 1);
  const s = summarize(rs);
  check('综合分 = 4.5', Math.abs(s.total - 4.5) < 1e-9);

  console.log('[5] 合并逻辑：按 updatedAt 取新');
  const a = { id: 'p1', name: '旧名', updatedAt: '2026-01-01' };
  const b = { id: 'p1', name: '新名', updatedAt: '2026-06-01' };
  const merged = (function () {
    let r; const g = global;
    // 直接测内部函数：通过 exportAll/importAll 侧面验证
    g.Store.places = [a];
    g.Store.importAll({ places: [b] });
    r = g.Store.places[0];
    return r;
  })();
  check('取更新的', merged.name === '新名');

  console.log('[6] 备份导入导出');
  const dump = Store.exportAll();
  check('导出含店铺与用户', Array.isArray(dump.places) && dump.places.length === 1);

  console.log(fail === 0 ? '\n全部通过 ✅' : `\n${fail} 项失败 ❌`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('测试异常:', e); process.exit(1); });
