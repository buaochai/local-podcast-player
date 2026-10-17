// Cloudflare Pages Functions：文稿的云同步，每篇文稿一行，存在 D1（绑定名 DB）。
// 账号由 _middleware.js 按 Cloudflare Access 登录的邮箱算出（ctx.data.uid）；k 是文件键（文件名|大小）。
var MAX = 1800000;   // D1 单行最多约 2MB
var PAGE = 10;

function json(body, status){
  return new Response(JSON.stringify(body), {status: status || 200, headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}});
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
// 读出某个时间之后改过的文稿，按 (updated, k) 翻页
export async function onRequestGet({request, env, data}){
  var id = data.uid;
  var u = new URL(request.url), since = +u.searchParams.get('since') || 0, after = u.searchParams.get('after') || '';
  await table(env.DB);
  var res = await env.DB.prepare('SELECT k, data, updated FROM tr WHERE id = ? AND (updated > ? OR (updated = ? AND k > ?)) ORDER BY updated, k LIMIT ?')
    .bind(id, since, since, after, PAGE + 1).all();
  var rows = res.results || [];
  return json({rows: rows.slice(0, PAGE), more: rows.length > PAGE});
}

export async function onRequestPut({request, env, data}){
  var id = data.uid;
  var text = await request.text();
  if(text.length > MAX) return json({error: '这篇文稿太大，没法同步'}, 413);
  var body;
  try{ body = JSON.parse(text); }catch(e){ return json({error: '格式不对'}, 400); }
  if(!body || typeof body.data !== 'string' || typeof body.k !== 'string' || !body.k || body.k.length > 600) return json({error: '格式不对'}, 400);
  await table(env.DB);
  var now = Date.now();
  await env.DB.prepare('INSERT INTO tr (id, k, data, updated) VALUES (?, ?, ?, ?) ON CONFLICT (id, k) DO UPDATE SET data = excluded.data, updated = excluded.updated')
    .bind(id, body.k, body.data, now).run();
  return json({updated: now});
}
