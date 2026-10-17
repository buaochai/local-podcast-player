# 本地播客

听手机里本地音频播客的网页，可以「添加到主屏幕」当 App 用（PWA）。

## 功能
- 点右上角「＋」从手机里选择音频文件（mp3、m4a、aac、wav、ogg、opus、flac），可以一次选多个；音频保存在网页里（IndexedDB），下次打开直接播放
- 每一集右边的「!」：查看文件信息、标签详情和收藏的时间点、移动到专辑、删除本地音频文件（保留记录）或删除整集
- 长按某一集或点右上角「选择」：多选，一起移动到专辑或删除
- 收藏时间点：播放器上的书签按钮，可以写收藏原因
- 自建专辑：首页右上角的文件夹按钮新建，「编辑」或长按专辑封面可以改专辑名称和创作者、删除专辑；没有专辑信息的音频放在「未分类」
- 首页「播客节目」：按音频里的专辑信息自动分成不同节目，显示节目封面；点进去是每一集和进度
- 底部悬浮播放器：封面、进度条、上一集 / 下一集、后退 / 快进 15 秒、倍速（滑动选择 0.5x – 3x）、定时关闭（滑动选择 5 – 180 分钟，或播完本集）
- 每一集自动记住听到的位置（按「文件名 + 文件大小」识别），重新选回同一个文件会接着播放
- 锁屏和通知栏显示封面（这一集没有就用专辑封面）、标题、创作者，可以用锁屏和耳机按钮控制；可以在「关于」里把「下一首」键改成收藏当前时间点
- AI 识别文稿：用自己的 API Key（OpenAI / Groq / 硅基流动 / Gemini / OpenRouter / 自定义）把音频识别成带时间的文字（单集、多选、整个专辑都可以），在独立的文稿页里点一句就跳到那里播放，文稿跟着播放滚动；顶部有 AI 自动分的章节条，收起时显示当前章节，展开选章节跳转；首页放大镜可搜节目、单集和文稿内容；识别默认在后台进行，顶部小图标点开看进度，弹窗都可以下滑关闭
- 「关于」里有功能介绍、版本号、「刷新」更新按钮和导出 / 导入记录
- 云同步（Cloudflare D1）：播放记录、收藏时间点、自建专辑、AI 设置（含 API Key）和文稿存到 D1，按 Cloudflare Access 登录的账号同步，登录同一账号的设备自动同步。音频不同步
- 集名优化（「关于」里可以关）：「0.」开头显示为「发刊词：」；名字前两个序号去掉第一个；番外以「番外：」开头。只改显示，列表顺序仍按文件名
- 首页固定一屏，不能缩放；断网也能打开

## 注意
- 音频和播放记录都存在浏览器里，清除浏览器的网站数据会被删除，请时常在「关于」里导出播放记录。
- 音频会在手机上多占一份空间，听完的集可以长按 →「删除本地音频文件」。

## 部署到 Cloudflare（云同步要用）
1. Cloudflare 后台 → Storage & Databases → D1 → Create：名字随便（如 `podcast`），位置选默认的 Location，不要选 jurisdiction。表不用手动建，第一次同步时会自动建。
2. Workers & Pages → Create → Pages → 连接 GitHub，选这个仓库：生产分支 `main`，Framework 选 None，构建命令留空，输出目录填 `/`。
3. 进这个 Pages 项目 → Settings → Bindings → Add → D1 database：变量名填 `DB`，选第 1 步的数据库。然后到 Deployments 里对最新一次部署点「Retry deployment」，绑定才会生效。
4. 按下面设置好登录后，打开 `xxx.pages.dev`，「关于」→「云同步」→「开启同步」。其他设备登录同一个账号后也点一下「开启同步」。

### 登录后才能打开（Cloudflare Access）
1. Cloudflare 后台左侧 → Zero Trust（第一次要选团队名和套餐，选 Free）。
2. Access → Applications → Add an application → Self-hosted：Application domain 填 `xxx.pages.dev`（再加一条 `*.xxx.pages.dev` 保护预览地址）；Session duration 可以选长一点（如 1 month），不用常常登录。
3. Policy：Action 选 Allow，Include 选 Emails，填自己的邮箱（可以填多个）。
4. 登录方式默认是 One-time PIN：打开网页时输入邮箱，收到验证码登录。
同步接口按登录的邮箱区分账号（`functions/api/_middleware.js` 读 Access 加的 `Cf-Access-Authenticated-User-Email` 请求头），没登录就不能同步。
更安全的做法：在 Pages 项目 → Settings → Variables 里加 `ACCESS_TEAM`（团队域名，如 `myteam.cloudflareaccess.com`）和 `ACCESS_AUD`（Access 应用页面上的 Application Audience (AUD) Tag），接口就会校验 Access 的签名令牌，而不是只看请求头。

后端接口是 `functions/api/sync.js`（Cloudflare Pages Functions）：`GET/PUT /api/sync`，D1 表 `sync(id, data, ver, updated)` 每个账号一行（`id` 是登录邮箱的 SHA-256），`ver` 用来防止两台设备同时上传互相覆盖。文稿走 `functions/api/tr.js`，表 `tr(id, k, data, updated)` 每篇文稿一行。数据以明文 JSON 存在你自己的 D1 里（含 API Key），靠 Cloudflare 登录保护。

## 文件
- `index.html`：整个网页
- `functions/api/sync.js`、`tr.js`：云同步接口（Cloudflare Pages Functions + D1）；`_middleware.js`：登录检查；`ali.js`：转发阿里云百炼的语音识别
- `manifest.webmanifest`、`sw.js`、`icon*`：PWA（主屏幕图标、离线缓存）
- `cover.svg` → `cover-*.png`、`apple-touch-icon.png`：方形满版封面（无透明），用于通知栏/锁屏封面、安卓自适应图标和 iPhone 主屏幕图标

改了网页文件时，要同时升 `index.html` 里的 `app-version` 和 `sw.js` 里的 `CACHE` 版本号，并写 `CHANGELOG.md`。
