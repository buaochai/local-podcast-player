// Cloudflare Pages Functions：替网页抓取播客的 RSS（只是一段文字的节目列表）。
// 大多数播客平台不让网页直接读 RSS（跨域限制），所以由这里代读。音频绝不经过这里：超过 5MB 的内容直接拒绝。
// 前面的 _middleware.js 已经检查过 Cloudflare Access 登录。
var MAX = 5 * 1024 * 1024;

function json(body, status){
  return new Response(JSON.stringify(body), {status: status || 200, headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}});
}

// 封面图：很多播客的图片服务器不让网页直接读（跨域），网页拿不到就请这里代取一张小图（最多 2MB，只收图片）
async function image(target){
  var u;
  try{ u = new URL(target); }catch(e){ return json({error: '图片地址不对'}, 400); }
  if(!/^https?:$/.test(u.protocol)) return json({error: '图片地址要以 http 或 https 开头'}, 400);
  var res;
  try{ res = await fetch(u.toString(), {headers: {'User-Agent': 'Mozilla/5.0 (local-podcast-player)', 'Accept': 'image/*'}, redirect: 'follow'}); }catch(e){ return json({error: '连不上这个图片地址'}, 502); }
  var type = res.headers.get('Content-Type') || '';
  if(!res.ok || !/^image\//i.test(type)) return json({error: '这不是一张图片'}, 400);
  if(+(res.headers.get('Content-Length') || 0) > 2 * 1024 * 1024) return json({error: '图片太大'}, 413);
  var buf = await res.arrayBuffer();
  if(buf.byteLength > 2 * 1024 * 1024) return json({error: '图片太大'}, 413);
  return new Response(buf, {headers: {'Content-Type': type, 'Cache-Control': 'private, max-age=86400'}});
}

// 音频地址：很多播客的音频地址要跳转好几次（统计服务 → 托管平台），百炼只认最后能直接下载的那个地址。
// 这里只顺着跳转找到最终地址（每一跳只请求第 1 个字节），音频本身不经过这里。
async function resolveAudio(target){
  var cur;
  try{ cur = new URL(target); }catch(e){ return json({error: '音频地址不对'}, 400); }
  for(var i = 0; i < 8; i++){
    if(!/^https?:$/.test(cur.protocol)) return json({error: '音频地址要以 http 或 https 开头'}, 400);
    var res;
    try{ res = await fetch(cur.toString(), {headers: {'User-Agent': 'Mozilla/5.0 (local-podcast-player)', 'Range': 'bytes=0-0'}, redirect: 'manual'}); }catch(e){ return json({error: '连不上这个音频地址'}, 502); }
    var loc = res.headers.get('Location');
    if(res.body) try{ res.body.cancel(); }catch(e){}
    if(res.status >= 300 && res.status < 400 && loc){ cur = new URL(loc, cur); continue; }
    return json({url: cur.toString(), status: res.status, type: res.headers.get('Content-Type') || ''});
  }
  return json({error: '音频地址跳转太多次'}, 502);
}

export async function onRequestGet({request}){
  var q = new URL(request.url).searchParams;
  if(q.get('img')) return image(q.get('img'));
  if(q.get('resolve')) return resolveAudio(q.get('resolve'));
  var target = q.get('url') || '', u;
  try{ u = new URL(target); }catch(e){ return json({error: 'RSS 地址不对'}, 400); }
  if(!/^https?:$/.test(u.protocol)) return json({error: 'RSS 地址要以 http 或 https 开头'}, 400);
  var res;
  try{
    res = await fetch(u.toString(), {headers: {'User-Agent': 'Mozilla/5.0 (local-podcast-player RSS reader)', 'Accept': 'application/rss+xml, application/xml, text/xml, */*'}, redirect: 'follow'});
  }catch(e){ return json({error: '连不上这个 RSS 地址'}, 502); }
  if(!res.ok) return json({error: 'RSS 地址返回 ' + res.status}, 502);
  var type = res.headers.get('Content-Type') || '';
  if(/^(audio|video|image)\//i.test(type)) return json({error: '这不是 RSS 地址，是音频或图片'}, 400);
  if(+(res.headers.get('Content-Length') || 0) > MAX) return json({error: 'RSS 内容太大（超过 5MB）'}, 413);
  // 边读边数，超过 5MB 就停
  var reader = res.body.getReader(), chunks = [], total = 0;
  for(;;){
    var r = await reader.read();
    if(r.done) break;
    total += r.value.length;
    if(total > MAX){ reader.cancel(); return json({error: 'RSS 内容太大（超过 5MB）'}, 413); }
    chunks.push(r.value);
  }
  var buf = new Uint8Array(total), off = 0;
  chunks.forEach(function(c){ buf.set(c, off); off += c.length; });
  // 按 RSS 里声明的编码解码（个别中文 RSS 用 GBK）
  var head = new TextDecoder('latin1').decode(buf.subarray(0, 300));
  var enc = (/encoding=["']([\w\-]+)["']/i.exec(head) || /charset=([\w\-]+)/i.exec(type) || [0, 'utf-8'])[1];
  var text;
  try{ text = new TextDecoder(enc).decode(buf); }catch(e){ text = new TextDecoder('utf-8').decode(buf); }
  return new Response(text, {headers: {'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Final-Url': res.url}});
}
