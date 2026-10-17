// /api/* 的登录检查：用 Cloudflare Access 登录的邮箱当作同步账号。
// 设置了环境变量 ACCESS_TEAM（如 myteam.cloudflareaccess.com）和 ACCESS_AUD（Access 应用的 AUD 标签）时，
// 会校验 Access 的签名令牌；没设置时直接用 Access 加的邮箱请求头。
var certs = null, certsAt = 0;

function b64url(s){
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while(s.length % 4) s += '=';
  var t = atob(s), b = new Uint8Array(t.length);
  for(var i = 0; i < t.length; i++) b[i] = t.charCodeAt(i);
  return b;
}
async function verifiedEmail(token, env){
  var parts = (token || '').split('.');
  if(parts.length !== 3) return '';
  var head = JSON.parse(new TextDecoder().decode(b64url(parts[0])));
  var body = JSON.parse(new TextDecoder().decode(b64url(parts[1])));
  if(!certs || Date.now() - certsAt > 3600000){
    var team = env.ACCESS_TEAM.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    certs = (await (await fetch('https://' + team + '/cdn-cgi/access/certs')).json()).keys || [];
    certsAt = Date.now();
  }
  var jwk = certs.find(function(k){ return k.kid === head.kid; });
  if(!jwk) return '';
  var key = await crypto.subtle.importKey('jwk', jwk, {name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256'}, false, ['verify']);
  var ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
  var aud = [].concat(body.aud || []);
  if(!ok || aud.indexOf(env.ACCESS_AUD) < 0 || (body.exp || 0) * 1000 < Date.now()) return '';
  return body.email || '';
}

export async function onRequest(ctx){
  var req = ctx.request, env = ctx.env, email = '';
  try{
    email = env.ACCESS_TEAM && env.ACCESS_AUD
      ? await verifiedEmail(req.headers.get('Cf-Access-Jwt-Assertion'), env)
      : req.headers.get('Cf-Access-Authenticated-User-Email') || '';
  }catch(e){ email = ''; }
  if(!email){
    return new Response(JSON.stringify({error: '没有登录：要先给网站开启 Cloudflare Access 登录'}), {status: 401, headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}});
  }
  if(!env.DB) return new Response(JSON.stringify({error: '没有绑定 D1 数据库（变量名要叫 DB）'}), {status: 500, headers: {'Content-Type': 'application/json'}});
  email = email.trim().toLowerCase();
  var h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('access:' + email));
  ctx.data.uid = Array.prototype.map.call(new Uint8Array(h), function(x){ return (x + 256).toString(16).slice(1); }).join('');
  ctx.data.email = email;
  return ctx.next();
}
