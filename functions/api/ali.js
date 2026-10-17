// Cloudflare Pages Functions：转发阿里云百炼（DashScope）的录音文件识别（Fun-ASR / Paraformer）。
// 阿里云的接口不让网页直接访问，所以由这里代发；API Key 由网页放在 X-Ali-Key 请求头里带过来，这里不保存。
// 这里只转发很小的文字请求，音频绝不经过 Cloudflare：
//   op=policy 拿上传凭证（网页拿到后自己把音频直接传到百炼的临时存储，得到 oss:// 地址，48 小时有效）
//   → op=submit 提交识别任务 → op=task 查询任务，完成时顺便把识别结果（文字）读回来。
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
  if(+(request.headers.get('Content-Length') || 0) > 65536) return json({error: '请求太大：音频不经过这里'}, 413);

  if(op === 'policy') return pass(await policy(base, key, model));

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
    var t = await tr.json(), out = t.output || t.data || {};
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
