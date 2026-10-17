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
- 云端音频（Cloudflare R2）：音频传到你自己的 R2，在线播放，多设备访问；音频由手机直接传给 R2，不经过 Cloudflare 后台
- 订阅播客（RSS）：首页 RSS 图标填 RSS 地址，自动抓取节目列表，在线播放，可以下载到本机；订阅列表云同步
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

### 云端音频（R2）
1. Cloudflare 后台左侧 → **Storage & databases** → **R2 object storage** → 第一次要先开通（需要绑付款方式，用量在免费额度内不扣钱）。
2. **Create bucket**：名字随便（如 `podcast-audio`），位置选 Automatic，存储类型选 **Standard**。
3. 进这个存储桶 → **Settings** → **CORS Policy** → **Add CORS policy**，粘贴下面的 JSON（把网址换成你自己的 `xxx.pages.dev`，用了自定义域名就也加上）：
   ```json
   [{"AllowedOrigins": ["https://xxx.pages.dev"], "AllowedMethods": ["GET", "PUT", "HEAD"], "AllowedHeaders": ["*"], "ExposeHeaders": ["ETag"], "MaxAgeSeconds": 3600}]
   ```
4. 回到 R2 总览页 → 右边 **Manage API Tokens**（或 Account details → API Tokens）→ **Create API token**：权限选 **Object Read & Write**，范围选刚建的存储桶。创建后会显示 **Access Key ID** 和 **Secret Access Key**（只显示一次，先复制下来）。同一页还能看到你的 **Account ID**。
5. Pages 项目 → **Settings** → **Variables and Secrets** → 添加四个变量（Secret 那个选 Secret 类型）：
   - `R2_ACCOUNT_ID`：账号 ID
   - `R2_ACCESS_KEY_ID`：Access Key ID
   - `R2_SECRET_ACCESS_KEY`：Secret Access Key
   - `R2_BUCKET`：存储桶名字
   然后到 **Deployments** 对最新一次部署点 **Retry deployment**，变量才生效。
6. 网页「关于」→「云端音频」→「检查」，显示「已连接」就好了。之后单集「!」→「上传到云端」，或者打开「添加音频时自动上传到云端」。
7. 建议：Cloudflare 账号的 **Notifications**（通知）里加一条用量或账单提醒，超出你设的数就发邮件。

R2 价格：存储每 GB 每月 0.015 美元（前 10GB 免费），下载流量免费，上传和读取的次数在个人用量下基本也在免费额度内（以 Cloudflare 官网为准）。R2 的空间和 D1 数据库互相独立，音频不会占 D1 的空间。

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
- `functions/api/sync.js`、`tr.js`：云同步接口（Cloudflare Pages Functions + D1）；`_middleware.js`：登录检查；`ali.js`：转发阿里云百炼的语音识别；`rss.js`：抓取 RSS；`r2.js`：给云端音频发临时上传 / 播放地址
- `manifest.webmanifest`、`sw.js`、`icon*`：PWA（主屏幕图标、离线缓存）
- `cover.svg` → `cover-*.png`、`apple-touch-icon.png`：方形满版封面（无透明），用于通知栏/锁屏封面、安卓自适应图标和 iPhone 主屏幕图标

改了网页文件时，要同时升 `index.html` 里的 `app-version` 和 `sw.js` 里的 `CACHE` 版本号，并写 `CHANGELOG.md`。
