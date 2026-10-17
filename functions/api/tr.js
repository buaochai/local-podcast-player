// Cloudflare Pages Functions：文稿的云同步，每篇文稿一行，存在 D1（绑定名 DB）。
// 和 sync.js 一样只存网页加密好的密文；k 是由密钥和文件名算出的编号，服务器看不到文件名。
var MAX = 1800000;   // D1 单行最多约 2MB
var PAGE = 10;
var CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Sync-Id',
  'Access-Control-Max-Age': '86400'
};

function json(body, status){
  return new Response(JSON.stringify(body), {status: status || 200, headers: Object.assign({'Content-Type': 'application/json', 'Cache-Control': 'no-store'}, CORS)});
}
var tableReady = false;
async function table(db){
  if(tableReady) return;
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS tr (id TEXT NOT NULL, k TEXT NOT NULL, data TEXT NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY (id, k))'),
    db.prepare('CREATE INDEX IF NOT EXISTS tr_updated ON tr (id, updated, k)')
  ]);
  tableReady = true;
}
function idOf(request){
  var id = request.headers.get('X-Sync-Id') || '';
  return /^[0-9a-f]{64}$/.test(id) ? id : '';
}

export async function onRequestOptions(){
  return new Response(null, {status: 204, headers: CORS});
}

// 读出某个时间之后改过的文稿，按 (updated, k) 翻页
export async function onRequestGet({request, env}){
  if(!env.DB) return json({error: '没有绑定 D1 数据库（变量名要叫 DB）'}, 500);
  var id = idOf(request);
  if(!id) return json({error: '缺少同步编号'}, 400);
  var u = new URL(request.url), since = +u.searchParams.get('since') || 0, after = u.searchParams.get('after') || '';
  await table(env.DB);
  var res = await env.DB.prepare('SELECT k, data, updated FROM tr WHERE id = ? AND (updated > ? OR (updated = ? AND k > ?)) ORDER BY updated, k LIMIT ?')
    .bind(id, since, since, after, PAGE + 1).all();
  var rows = res.results || [];
  return json({rows: rows.slice(0, PAGE), more: rows.length > PAGE});
}

export async function onRequestPut({request, env}){
  if(!env.DB) return json({error: '没有绑定 D1 数据库（变量名要叫 DB）'}, 500);
  var id = idOf(request);
  if(!id) return json({error: '缺少同步编号'}, 400);
  var text = await request.text();
  if(text.length > MAX) return json({error: '这篇文稿太大，没法同步'}, 413);
  var body;
  try{ body = JSON.parse(text); }catch(e){ return json({error: '格式不对'}, 400); }
  if(!body || typeof body.data !== 'string' || !/^[0-9a-f]{64}$/.test(body.k || '')) return json({error: '格式不对'}, 400);
  await table(env.DB);
  var now = Date.now();
  await env.DB.prepare('INSERT INTO tr (id, k, data, updated) VALUES (?, ?, ?, ?) ON CONFLICT (id, k) DO UPDATE SET data = excluded.data, updated = excluded.updated')
    .bind(id, body.k, body.data, now).run();
  return json({updated: now});
}
