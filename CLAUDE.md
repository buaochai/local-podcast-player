# 给 Claude 的项目说明

- 单文件手机网页 `index.html`（本地播客播放器），PWA 文件是 `manifest.webmanifest`、`sw.js`、`icon*`、`cover*`（通知栏/锁屏封面必须是不透明的方形图）。用 GitHub Pages 从 `main` 发布：https://buaochai.github.io/local-podcast-player/
- 播放记录存在 `localStorage`（`lpp.records.v1`），键是「文件名|文件大小」，记录里带节目名 `show`（实际显示的专辑）、`tagShow`（音频标签里的专辑）、`customShow`（用户移动后的专辑）、标题 `title`、收藏时间点 `marks:[{t,note,created}]`；自建专辑在 `lpp.shows.v1` 里标 `custom:true`；节目封面小图在 `lpp.shows.v1`；音频文件本身存在 IndexedDB（库 `lpp` 版本 2，表 `files` 和 `transcripts`，主键同上；文稿 `{segments:[{t,text}], done, total, status}`）。专辑识别按文件内容判断格式（ID3v2.2/2.3/2.4、ID3v1、APEv2、MP4、FLAC、Ogg），每次打开重新识别；`readTags` 的结果里 `frames` 是给「标签详情」看的原始内容。没有专辑的放在 `OTHER`（「未分类」，旧版叫「其他音频」，`migrateOther` 负责改名）。改数据格式要兼容旧记录和导出文件。
- 每次改网页：升 `<meta name="app-version">`、同步升 `sw.js` 里的 `CACHE`，写 `CHANGELOG.md`，回复里先给版本号。
- 首页固定一屏：不能缩放、页面不能滚动，只有 `.view` 内容区域内部滚动（节目页是 `.list-scroll` 里的列表滚动，封面和标题固定），底部是悬浮播放器 `.mini`。新增内容不要撑出屏幕。
- 界面文字用中文。
- 同名 CSS 类会冲突（例如 `.toast.show`），新增类名前先搜索一下。
- 顶部提示、标题等文字最多两行（`.clamp2`），信息行一行（`.line1`）。
- 使用者已授权：每次改完测试通过后，直接推送并合并到 `main` 发布，不用再问。
- 专辑页：单集右边的「!」打开详情菜单 `showEpMenu`；长按或「选择」进入多选（`selMode` / `selKeys`），底部 `.selbar` 操作。
- 锁屏信息（`setMediaSession`）：封面用 `artFor`（本集封面 > 专辑封面，data 链接要转 blob），创作者用 `authorOf`（`shows[专辑].author` > 标签艺术家）。网页无法在锁屏加自定义按钮，只能给 `nexttrack` 换功能（设置 `nextMark`）。
- 「未分类」(`OTHER`) 不显示、也不存任何封面（`coverInfo` 直接返回 null）。
- AI 文稿：配置在 `lpp.ai.v1`（含 API Key，不进导出文件），语音识别用 `AI_PROVIDERS`，分章节用的文本模型放在 `ai.chat`（`LLM_PROVIDERS`，`llmCall` 分 Claude 的 /v1/messages 和 OpenAI 兼容的 /chat/completions 两种；Claude 浏览器直连必须带 `anthropic-dangerous-direct-browser-access: true`，且不要传 temperature）。章节存在文稿记录的 `chapters:[{t,title}]` 里（`chapterize` / `parseChapters`）。两种请求：`reqWhisper`（/audio/transcriptions，multipart）和 `reqChat`（/chat/completions + input_audio）。切段：`mp3Plan`（按帧）、`mp4Plan`/`buildM4a`（重新封装 m4a）、`toWav`（转 16k 单声道）。不要用正则后行断言（旧 Safari 不认）。`ai.maxSec` 是调试用的隐藏项（强制每段最长秒数）。
- 测试：用本地模拟服务测过（OpenAI 转写 / 聊天两种格式，切出来的每段用 ffmpeg 检查过），没有对真实服务商测过，只有 Gemini 的跨域预检确认过可用。
- 转文字入口：单集「!」菜单（`trOpen`）、多选 `bSelTr` 和长按专辑（都走 `trBatch`，逐集 `trRun`，`trJob` 同一时间只有一个）。首页封面是 `.pod-3d`（侧转 + 厚度 + 高光），图片和高光必须放在同一个 `.pod-face` 里，不然会和侧边厚度互相切割。
- 页面有三层：首页 `home`、专辑页 `show`、文稿页 `ep`（`view.page`，用 history.pushState 存 `{show}` / `{ep}`，返回键一层层退）。点一集 → `openEpPage`（播放并进入文稿页）；播放别的集时文稿页跟着换（`open()` 里处理）。文稿页用 `renderEp`，章节条和文稿列表分开，只有列表在 `.list-scroll` 里滚动。
- 识别入口都先弹小确认窗 `trAsk`（Promise，不要再用 `confirm`），默认后台识别；顶部 `#bTrJob` 是进度图标，点开 `#trProgSheet`。所有 `.sheet` 都支持下滑关闭（统一在 `renderOpts` 前那段手势代码）。首页封面图元素存在 `homeImgs` 里复用，别每次重画都新建。启动时读文件库失败时用 `healEp` 按需补读。
- 首页搜索：`#bSearch` / `#searchIn`，搜索时 `renderSearch` 代替网格，文稿从 IndexedDB 一次性读进 `trCache`。专辑页重画时 `.pod-head` 用 `dataset.sig` 判断没变就保留（`render()` 里的 `keepHead`），封面图元素 `headImg` 只能放进真正用到的那个 head 里。专辑名排版 `showNameLines`。「下一首」键只切下一集，不再有收藏功能。
- 分季专辑：`parseSeason` 按名字解析（总名称 / 第X季 / 副标题），首页同一总名称至少两季时叠成 `.pod-stack`，展开状态在 `openSeries`。文稿页顶部不显示标题，有 `#bHome`；history state 带 `d`（距首页的层数），`#bHome` 用 `history.go(-d)` 回首页。OpenRouter 有两个服务商：`openrouter`（聊天听音频）和 `openrouter_stt`（转写，模型带 `openai/` 前缀）。
