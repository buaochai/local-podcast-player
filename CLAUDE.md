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
- AI 文稿：配置在 `lpp.ai.v1`（含 API Key，不进导出文件）。两种请求：`reqWhisper`（/audio/transcriptions，multipart）和 `reqChat`（/chat/completions + input_audio）。切段：`mp3Plan`（按帧）、`mp4Plan`/`buildM4a`（重新封装 m4a）、`toWav`（转 16k 单声道）。不要用正则后行断言（旧 Safari 不认）。`ai.maxSec` 是调试用的隐藏项（强制每段最长秒数）。
- 测试：用本地模拟服务测过（OpenAI 转写 / 聊天两种格式，切出来的每段用 ffmpeg 检查过），没有对真实服务商测过，只有 Gemini 的跨域预检确认过可用。
