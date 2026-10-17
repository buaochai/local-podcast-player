// Cloudflare Pages Functions：转发阿里云百炼（DashScope）的录音文件识别（Fun-ASR / Paraformer）。
// 阿里云的接口不让网页直接访问，所以由这里代发；API Key 由网页放在 X-Ali-Key 请求头里带过来，这里不保存。
// 流程：op=upload 把一段音频传到百炼的临时存储（得到 oss:// 地址，48 小时有效）→ op=submit 提交识别任务
//      → op=task 查询任务，完成时顺便把识别结果文件读回来。op=policy 只用来测试 Key。
// 前面的 _middleware.js 已经检查过 Cloudflare Access 登录，不是谁都能用这个转发。
var DEFAULT_BASE = 'https://dashscope.aliyuncs.com/api/v1';

function json(body, status){
  return new Response(JSON.stringify(body), {status: status || 200, headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}});
}
// 只转发到阿里云的地址
function aliUrl(u){
  try{ var x = new URL(u); return /^https?:$/.test(x.protocol) && /(^|\.)aliyuncs\.com$/.test(x.hostname) ? x : null; }catch(e){ return null; }
}
function baseOf(url){
  var b = url.searchParams.get('base') || DEFAULT_BASE;
  return aliUrl(b) ? b.replace(/\/+$/, '') : '';
}
// 把阿里云的回应原样传回去（状态码也一样），网页按状态码判断出错原因
async function pass(res){
  var text = await res.text();
  return new Response(text, {status: res.status, headers: {'Content-Type': res.headers.get('Content-Type') || 'application/json', 'Cache-Control': 'no-store'}});
}
function auth(key, extra){
  return Object.assign({Authorization: 'Bearer ' + key}, extra || {});
}
async function policy(base, key, model){
  return fetch(base + '/uploads?action=getPolicy&model=' + encodeURIComponent(model), {headers: auth(key)});
}

export async function onRequest({request}){
  var url = new URL(request.url), op = url.searchParams.get('op') || '';
  var key = request.headers.get('X-Ali-Key') || '';
  var base = baseOf(url);
  if(!key) return json({error: '缺少百炼的 API Key'}, 400);
  if(!base) return json({error: '接口地址不对：只能是阿里云的地址'}, 400);
  var model = url.searchParams.get('model') || 'fun-asr';

  if(op === 'policy') return pass(await policy(base, key, model));

  if(op === 'upload' && request.method === 'POST'){
    var pr = await policy(base, key, model);
    if(!pr.ok) return pass(pr);
    var p = (await pr.json()).output || {};
    var host = aliUrl(p.upload_host || '');
    if(!host) return json({error: '百炼没有给出上传地址'}, 502);
    var name = (url.searchParams.get('name') || 'part.mp3').replace(/[^\w.\-]/g, '_');
    var objKey = p.upload_dir + '/' + Date.now() + '_' + name;
    var type = request.headers.get('Content-Type') || 'application/octet-stream';
    var fields = [['OSSAccessKeyId', p.oss_access_key_id], ['Signature', p.signature], ['policy', p.policy], ['key', objKey],
      ['x-oss-object-acl', p.x_oss_object_acl], ['x-oss-forbid-overwrite', p.x_oss_forbid_overwrite],
      ['success_action_status', '200'], ['x-oss-content-type', type]];
    // 自己拼 multipart：音频边收边转发给阿里云，不在这里整段读进内存（大文件会超出 Cloudflare 免费版的限制）
    var boundary = '----lpp' + crypto.randomUUID().replace(/-/g, '');
    var enc = new TextEncoder();
    var head = enc.encode(fields.map(function(f){ return '--' + boundary + '\r\nContent-Disposition: form-data; name="' + f[0] + '"\r\n\r\n' + f[1] + '\r\n'; }).join('')
      + '--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="' + name + '"\r\nContent-Type: ' + type + '\r\n\r\n');
    var tail = enc.encode('\r\n--' + boundary + '--\r\n');
    var len = +(request.headers.get('Content-Length') || 0), body;
    if(len > 0 && typeof FixedLengthStream === 'function' && request.body){
      var fl = new FixedLengthStream(head.length + len + tail.length);
      body = fl.readable;
      (async function(){
        var w = fl.writable.getWriter();
        await w.write(head); w.releaseLock();
        await request.body.pipeTo(fl.writable, {preventClose: true});
        w = fl.writable.getWriter();
        await w.write(tail); await w.close();
      })().catch(function(){});
    }else{
      body = new Blob([head, await request.arrayBuffer(), tail]);
    }
    var up = await fetch(host.toString(), {method: 'POST', body: body, headers: {'Content-Type': 'multipart/form-data; boundary=' + boundary}});
    if(!up.ok) return json({error: '上传到百炼临时存储失败（' + up.status + '）：' + (await up.text()).slice(0, 300)}, 502);
    return json({url: 'oss://' + objKey});
  }

  if(op === 'submit' && request.method === 'POST'){
    var b = await request.json().catch(function(){ return null; });
    if(!b || !b.url) return json({error: '格式不对'}, 400);
    var body = {model: b.model || model, input: {file_urls: [b.url]}, parameters: b.parameters || {}};
    return pass(await fetch(base + '/services/audio/asr/transcription', {
      method: 'POST',
      headers: auth(key, {'Content-Type': 'application/json', 'X-DashScope-Async': 'enable', 'X-DashScope-OssResourceResolve': 'enable'}),
      body: JSON.stringify(body)
    }));
  }

  if(op === 'task'){
    var id = url.searchParams.get('id') || '';
    if(!/^[\w\-]+$/.test(id)) return json({error: '任务编号不对'}, 400);
    var tr = await fetch(base + '/tasks/' + id, {headers: auth(key)});
    if(!tr.ok) return pass(tr);
    var t = await tr.json(), out = t.output || {};
    // 完成了：把每个结果文件读回来，网页就不用再去阿里云取
    if(out.task_status === 'SUCCEEDED'){
      out.transcripts = [];
      for(var r of out.results || []){
        var ru = r.subtask_status === 'SUCCEEDED' && aliUrl(r.transcription_url || '');
        if(ru){
          var rr = await fetch(ru.toString());
          if(rr.ok) out.transcripts.push(await rr.json());
        }
      }
    }
    return json(t);
  }

  return json({error: '不认识的操作'}, 400);
}
