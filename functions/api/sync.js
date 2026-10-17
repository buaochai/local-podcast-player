// Cloudflare Pages Functions：云同步接口，数据存在 D1（绑定名 DB）。
// 网页在手机上先用同步密码加密再上传，这里只存密文，看不到内容。
// 请求头 X-Sync-Id 是由同步密码算出来的 64 位编号，相当于账号。
var MAX = 1500000;   // D1 单行最多约 2MB，留点余量
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
  await db.prepare('CREATE TABLE IF NOT EXISTS sync (id TEXT PRIMARY KEY, data TEXT NOT NULL, ver INTEGER NOT NULL, updated INTEGER NOT NULL)').run();
  tableReady = true;
}
function idOf(request){
  var id = request.headers.get('X-Sync-Id') || '';
  return /^[0-9a-f]{64}$/.test(id) ? id : '';
}
async function get(db, id){
  return db.prepare('SELECT data, ver, updated FROM sync WHERE id = ?').bind(id).first();
}

export async function onRequestOptions(){
  return new Response(null, {status: 204, headers: CORS});
}

export async function onRequestGet({request, env}){
  if(!env.DB) return json({error: '没有绑定 D1 数据库（变量名要叫 DB）'}, 500);
  var id = idOf(request);
  if(!id) return json({error: '缺少同步编号'}, 400);
  await table(env.DB);
  var row = await get(env.DB, id);
  return json(row ? {ver: row.ver, updated: row.updated, data: row.data} : {ver: 0});
}

// 上传：带上自己基于的版本号 ver，和服务器上的不一致就返回 409，让网页先合并再传
export async function onRequestPut({request, env}){
  if(!env.DB) return json({error: '没有绑定 D1 数据库（变量名要叫 DB）'}, 500);
  var id = idOf(request);
  if(!id) return json({error: '缺少同步编号'}, 400);
  var text = await request.text();
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
