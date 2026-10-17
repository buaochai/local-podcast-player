// Cloudflare Pages Functions：云同步接口，数据存在 D1（绑定名 DB）。
// 账号由 _middleware.js 按 Cloudflare Access 登录的邮箱算出（ctx.data.uid），每个账号一行。
var MAX = 1800000;   // D1 单行最多约 2MB

function json(body, status){
  return new Response(JSON.stringify(body), {status: status || 200, headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}});
}
var tableReady = false;
async function table(db){
  if(tableReady) return;
  await db.prepare('CREATE TABLE IF NOT EXISTS sync (id TEXT PRIMARY KEY, data TEXT NOT NULL, ver INTEGER NOT NULL, updated INTEGER NOT NULL)').run();
  tableReady = true;
}
async function get(db, id){
  return db.prepare('SELECT data, ver, updated FROM sync WHERE id = ?').bind(id).first();
}

export async function onRequestGet({env, data}){
  await table(env.DB);
  var row = await get(env.DB, data.uid);
  return json(row ? {ver: row.ver, updated: row.updated, data: row.data, email: data.email} : {ver: 0, email: data.email});
}

// 上传：带上自己基于的版本号 ver，和服务器上的不一致就返回 409，让网页先合并再传
export async function onRequestPut({request, env, data}){
  var id = data.uid, text = await request.text();
  if(text.length > MAX) return json({error: '数据太大'}, 413);
  var body;
  try{ body = JSON.parse(text); }catch(e){ return json({error: '格式不对'}, 400); }
  if(!body || typeof body.data !== 'string' || typeof body.ver !== 'number') return json({error: '格式不对'}, 400);
  await table(env.DB);
  var now = Date.now(), res;
  if(body.ver === 0){
    res = await env.DB.prepare('INSERT OR IGNORE INTO sync (id, data, ver, updated) VALUES (?, ?, 1, ?)').bind(id, body.data, now).run();
  }else{
    res = await env.DB.prepare('UPDATE sync SET data = ?, ver = ver + 1, updated = ? WHERE id = ? AND ver = ?').bind(body.data, now, id, body.ver).run();
  }
  if(!res.meta || !res.meta.changes){
    var row = await get(env.DB, id);
    return json(row ? {conflict: true, ver: row.ver, updated: row.updated, data: row.data} : {conflict: true, ver: 0}, 409);
  }
  return json({ver: body.ver + 1, updated: now});
}
