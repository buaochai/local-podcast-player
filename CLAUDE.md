# 给 Claude 的项目说明

- 单文件手机网页 `index.html`（本地播客播放器），PWA 文件是 `manifest.webmanifest`、`sw.js`、`icon*`。用 GitHub Pages 从 `main` 发布：https://buaochai.github.io/local-podcast-player/
- 播放记录存在 `localStorage`（`lpp.records.v1`），键是「文件名|文件大小」；改数据格式要兼容旧记录和导出文件。
- 每次改网页：升 `<meta name="app-version">`、同步升 `sw.js` 里的 `CACHE`，写 `CHANGELOG.md`，回复里先给版本号。
- 首页固定一屏：不能缩放、页面不能滚动，只有 `.panel` 列表区域内部滚动。新增内容不要撑出屏幕。
- 界面文字用中文。
