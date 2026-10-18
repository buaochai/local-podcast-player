// Cloudflare Pages Functions：云端音频（R2）。
// 这里只处理很小的文字请求，音频绝不经过这里：网页用这里发的「临时上传地址」直接把音频传给 R2，
// 播放和下载也是用这里发的「临时播放地址」直接从 R2 取。临时地址用 R2 的 S3 密钥在这里本地算出，不需要访问 R2。
// 前面的 _middleware.js 已经检查过 Cloudflare Access 登录，ctx.data.uid 是登录账号。
//
// 环境变量（Pages 项目 → Settings → Variables and Secrets）：
//   R2_ACCOUNT_ID  Cloudflare 账号 ID
//   R2_ACCESS_KEY_ID、R2_SECRET_ACCESS_KEY  R2 的 API 令牌（只要这个存储桶的读写权限）
//   R2_BUCKET  存储桶名字
//   R2_ENDPOINT  （可选，只在测试时用）覆盖 https://<账号 ID>.r2.cloudflarestorage.com
//
// 请求：POST /api/r2，JSON
//   {op:'put', name, type}      → {key, url}      新文件的 key 和临时上传地址（1 小时有效）
//   {op:'get', keys:[...]}      → {urls:{key:url}} 临时播放 / 下载地址（12 小时有效）
//   {op:'delete', keys:[...]}   → {deleted:n}      在这里直接删（很小的请求）
//   {op:'usage'}                → {count, bytes}   云端已存多少
//   {op:'folders'}              → {folders:[{dir,count,bytes}]} 存储桶里有音频的文件夹（不含 u/ 目录），让网页选着导入
//   {op:'list', prefix}         → {files:[{key,size}]} 列出存储桶里某个文件夹下的文件（用来导入自己拖进去的文件夹）
var enc = new TextEncoder();
var PUT_TTL = 3600, GET_TTL = 12 * 3600;

function json(body, status){
  return new Response(JSON.stringify(body), {status: status || 200, headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}});
}
function hex(buf){ return Array.prototype.map.call(new Uint8Array(buf), function(x){ return (x + 256).toString(16).slice(1); }).join(''); }
async function sha256hex(text){ return hex(await crypto.subtle.digest('SHA-256', enc.encode(text))); }
async function hmac(key, text){
  var k = await crypto.subtle.importKey('raw', key, {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(text)));
}
// AWS 规定的 URI 编码：只有 A-Za-z0-9 - _ . ~ 不编码（路径里的 / 也保留）
function uriEncode(s, keepSlash){
  return Array.prototype.map.call(enc.encode(s), function(b){
    var c = String.fromCharCode(b);
    return /[A-Za-z0-9\-_.~]/.test(c) || (keepSlash && c === '/') ? c : '%' + (b + 256).toString(16).slice(1).toUpperCase();
  }).join('');
}
function cfg(env){
  var miss = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'].filter(function(k){ return !env[k]; });
  if(miss.length) return {missing: miss};
  var endpoint = (env.R2_ENDPOINT || 'https://' + env.R2_ACCOUNT_ID + '.r2.cloudflarestorage.com').replace(/\/+$/, '');
  return {endpoint: endpoint, host: new URL(endpoint).host, basePath: new URL(endpoint).pathname.replace(/\/+$/, ''), ak: env.R2_ACCESS_KEY_ID, sk: env.R2_SECRET_ACCESS_KEY, bucket: env.R2_BUCKET};
}
// S3 的 SigV4「临时地址」（签名放在网址里）。extra 是要一起签的网址参数（如列文件用的 list-type）
export async function presign(c, method, key, ttl, extra, now){
  now = now || new Date();
  var amz = now.toISOString().replace(/[:\-]|\.\d{3}/g, ''), date = amz.slice(0, 8), scope = date + '/auto/s3/aws4_request';
  var path = c.basePath + '/' + uriEncode(c.bucket) + '/' + (key ? uriEncode(key, true) : '');   // 列文件时路径以 / 结尾，和官方 SDK 一致
  // 参数和官方 SDK 生成的完全一样（包括 X-Amz-Content-Sha256），这样的地址已知能在 R2 上用
  var q = {'X-Amz-Algorithm': 'AWS4-HMAC-SHA256', 'X-Amz-Content-Sha256': 'UNSIGNED-PAYLOAD', 'X-Amz-Credential': c.ak + '/' + scope, 'X-Amz-Date': amz, 'X-Amz-Expires': String(ttl), 'X-Amz-SignedHeaders': 'host'};
  Object.keys(extra || {}).forEach(function(k){ q[k] = extra[k]; });
  var qs = Object.keys(q).sort().map(function(k){ return uriEncode(k) + '=' + uriEncode(q[k]); }).join('&');
  var canonical = [method, path, qs, 'host:' + c.host + '\n', 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  var sts = ['AWS4-HMAC-SHA256', amz, scope, await sha256hex(canonical)].join('\n');
  var k = await hmac(enc.encode('AWS4' + c.sk), date);
  k = await hmac(k, 'auto'); k = await hmac(k, 's3'); k = await hmac(k, 'aws4_request');
  var sig = hex(await hmac(k, sts));
  return c.endpoint + path.slice(c.basePath.length) + '?' + qs + '&X-Amz-Signature=' + sig;
}
function prefixOf(uid){ return 'u/' + uid.slice(0, 16) + '/'; }
function ownKey(uid, key){ return typeof key === 'string' && key.indexOf(prefixOf(uid)) === 0 && key.length < 300 && key.indexOf('..') < 0; }
// 读：自己的目录，或者你自己拖进存储桶的文件夹（不在别人的 u/ 目录下）；写和删只能动自己的目录
function canRead(uid, key){ return typeof key === 'string' && key.length < 300 && key.indexOf('..') < 0 && key.charAt(0) !== '/' && (key.indexOf('u/') !== 0 || key.indexOf(prefixOf(uid)) === 0); }
function xmlDecode(t){ return t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'); }
function randomId(){ return hex(crypto.getRandomValues(new Uint8Array(10))); }

export async function onRequestPost({request, env, data}){
  var c = cfg(env);
  if(c.missing) return json({error: '还没有配置云端存储（R2）：Pages 项目里缺少环境变量 ' + c.missing.join('、'), missing: c.missing}, 501);
  if(+(request.headers.get('Content-Length') || 0) > 65536) return json({error: '请求太大：音频不经过这里'}, 413);
  var body = await request.json().catch(function(){ return null; });
  if(!body) return json({error: '格式不对'}, 400);
  var uid = data.uid, op = body.op;

  if(op === 'put'){
    var name = String(body.name || ''), ext = (/\.([A-Za-z0-9]{1,5})$/.exec(name) || [0, 'mp3'])[1].toLowerCase();
    var key = prefixOf(uid) + randomId() + '.' + ext;
    return json({key: key, url: await presign(c, 'PUT', key, PUT_TTL)});
  }
  if(op === 'cover'){   // 封面小图：key 由网页按专辑算出，只能放在自己的目录下
    var ck = prefixOf(uid) + 'covers/' + String(body.id || '').replace(/[^0-9a-f]/g, '').slice(0, 40) + '.jpg';
    if(ck.length < prefixOf(uid).length + 14) return json({error: '格式不对'}, 400);
    return json({key: ck, url: await presign(c, 'PUT', ck, PUT_TTL)});
  }
  if(op === 'get'){
    var keys = Array.isArray(body.keys) ? body.keys.slice(0, 200) : [], urls = {};
    for(var i = 0; i < keys.length; i++) if(canRead(uid, keys[i])) urls[keys[i]] = await presign(c, 'GET', keys[i], GET_TTL);
    return json({urls: urls});
  }
  if(op === 'delete'){
    var del = Array.isArray(body.keys) ? body.keys.slice(0, 100) : [], n = 0;
    for(var j = 0; j < del.length; j++){
      if(!ownKey(uid, del[j])) continue;
      var r = await fetch(await presign(c, 'DELETE', del[j], 300), {method: 'DELETE'}).catch(function(){ return null; });
      if(r && (r.ok || r.status === 404)) n++;
    }
    return json({deleted: n});
  }
  if(op === 'folders'){
    var map = {}, ft = '', fp = 0, AUD = /\.(mp3|m4a|m4b|aac|wav|ogg|oga|opus|flac|mp4)$/i;
    do{
      var fx = {'list-type': '2', 'max-keys': '1000'};
      if(ft) fx['continuation-token'] = ft;
      var fr = await fetch(await presign(c, 'GET', '', 300, fx)).catch(function(){ return null; });
      if(!fr) return json({error: '连不上 R2'}, 502);
      var ftx = await fr.text();
      if(fr.status === 403) return json({error: 'R2 拒绝访问：访问密钥不对，或令牌没有这个存储桶的权限'}, 403);
      if(!fr.ok) return json({error: 'R2 返回 ' + fr.status}, 502);
      var fre = /<Contents>([\s\S]*?)<\/Contents>/g, fm;
      while((fm = fre.exec(ftx))){
        var fk = /<Key>([\s\S]*?)<\/Key>/.exec(fm[1]), fs = /<Size>(\d+)<\/Size>/.exec(fm[1]);
        if(!fk || !fs) continue;
        var key2 = xmlDecode(fk[1]), cut = key2.lastIndexOf('/');
        if(cut < 1 || key2.indexOf('u/') === 0 || !AUD.test(key2) || +fs[1] <= 0) continue;
        var d = key2.slice(0, cut), e = map[d] || (map[d] = {dir: d, count: 0, bytes: 0});
        e.count++; e.bytes += +fs[1];
      }
      var fnt = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(ftx);
      ft = /<IsTruncated>true<\/IsTruncated>/.test(ftx) && fnt ? xmlDecode(fnt[1]) : '';
    }while(ft && ++fp < 20);
    return json({folders: Object.keys(map).sort().map(function(k){ return map[k]; })});
  }
  if(op === 'list'){
    var pre = String(body.prefix || '').replace(/^\/+/, '');
    if(pre && pre.charAt(pre.length - 1) !== '/') pre += '/';
    if(!pre || !canRead(uid, pre)) return json({error: '文件夹名不对'}, 400);
    var files = [], tk = '', pg = 0;
    do{
      var ex = {'list-type': '2', 'prefix': pre, 'max-keys': '1000'};
      if(tk) ex['continuation-token'] = tk;
      var rr = await fetch(await presign(c, 'GET', '', 300, ex)).catch(function(){ return null; });
      if(!rr) return json({error: '连不上 R2'}, 502);
      var tx = await rr.text();
      if(rr.status === 403) return json({error: 'R2 拒绝访问：访问密钥不对，或令牌没有这个存储桶的权限'}, 403);
      if(!rr.ok) return json({error: 'R2 返回 ' + rr.status}, 502);
      var cre = /<Contents>([\s\S]*?)<\/Contents>/g, cm;
      while((cm = cre.exec(tx))){
        var kk = /<Key>([\s\S]*?)<\/Key>/.exec(cm[1]), sz = /<Size>(\d+)<\/Size>/.exec(cm[1]);
        if(kk && sz) files.push({key: xmlDecode(kk[1]), size: +sz[1]});
      }
      var nt2 = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(tx);
      tk = /<IsTruncated>true<\/IsTruncated>/.test(tx) && nt2 ? xmlDecode(nt2[1]) : '';
    }while(tk && ++pg < 10);
    return json({files: files});
  }
  if(op === 'usage'){
    var count = 0, bytes = 0, token = '', pages = 0;
    do{
      var extra = {'list-type': '2', 'prefix': prefixOf(uid), 'max-keys': '1000'};
      if(token) extra['continuation-token'] = token;
      var lr = await fetch(await presign(c, 'GET', '', 300, extra)).catch(function(){ return null; });
      if(!lr) return json({error: '连不上 R2'}, 502);
      var xml = await lr.text();
      if(lr.status === 403) return json({error: 'R2 拒绝访问：访问密钥（Access Key / Secret）不对，或这个令牌没有这个存储桶的权限'}, 403);
      if(lr.status === 404) return json({error: '找不到存储桶「' + c.bucket + '」：检查 R2_BUCKET 是不是写对了'}, 404);
      if(!lr.ok) return json({error: 'R2 返回 ' + lr.status + '：' + xml.slice(0, 200)}, 502);
      var re = /<Size>(\d+)<\/Size>/g, m;
      while((m = re.exec(xml))){ count++; bytes += +m[1]; }
      var nt = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml);
      token = /<IsTruncated>true<\/IsTruncated>/.test(xml) && nt ? nt[1].replace(/&amp;/g, '&') : '';
    }while(token && ++pages < 20);
    return json({count: count, bytes: bytes});
  }
  return json({error: '不认识的操作'}, 400);
}
