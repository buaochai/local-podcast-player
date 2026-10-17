# 给 Claude 的项目说明

- 单文件手机网页 `index.html`（本地播客播放器），PWA 文件是 `manifest.webmanifest`、`sw.js`、`icon*`、`cover*`（通知栏/锁屏封面必须是不透明的方形图）。用 GitHub Pages 从 `main` 发布：https://buaochai.github.io/local-podcast-player/
- 播放记录存在 `localStorage`（`lpp.records.v1`），键是「文件名|文件大小」，记录里带节目名 `show`（实际显示的专辑）、`tagShow`（音频标签里的专辑）、`customShow`（用户移动后的专辑）、标题 `title`、收藏时间点 `marks:[{t,note,created}]`；自建专辑在 `lpp.shows.v1` 里标 `custom:true`；节目封面小图在 `lpp.shows.v1`；音频文件本身存在 IndexedDB（库 `lpp`，表 `files`，主键同上）。专辑识别按文件内容判断格式（ID3v2/ID3v1/MP4），每次打开重新识别。改数据格式要兼容旧记录和导出文件。
- 每次改网页：升 `<meta name="app-version">`、同步升 `sw.js` 里的 `CACHE`，写 `CHANGELOG.md`，回复里先给版本号。
- 首页固定一屏：不能缩放、页面不能滚动，只有 `.view` 内容区域内部滚动，底部是悬浮播放器 `.mini`。新增内容不要撑出屏幕。
- 界面文字用中文。
- 同名 CSS 类会冲突（例如 `.toast.show`），新增类名前先搜索一下。
- 顶部提示、标题等文字最多两行（`.clamp2`），信息行一行（`.line1`）。
