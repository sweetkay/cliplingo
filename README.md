# ClipLingo

ClipLingo 是一个面向个人使用的 Chrome / Edge 英语视频学习插件。它能识别网页视频字幕，显示双语字幕，保存当前语句及对应原声，并在本地语句库中提供循环播放、查词、AI 讲解和基础跟读评分。

## 安装

1. 运行 `npm install` 和 `npm run build`。
2. 打开 `chrome://extensions` 或 `edge://extensions`。
3. 开启“开发者模式”。
4. 点击“加载已解压的扩展程序”，选择项目中的 `dist` 文件夹。
5. 打开 YouTube、Bilibili 或带 HTML5 字幕的视频页面。
6. 点击 ClipLingo 图标，再点击“开始学习”。

## API 配置

打开插件设置，填写 OpenAI-compatible API 的 Base URL、API Key 与模型名称。API Key 仅保存在浏览器本地，不包含在语句库导出文件中。

## MVP 功能

- YouTube、Bilibili、HTML5 TextTrack 与通用 DOM 字幕识别
- 双语字幕悬浮层
- 单句循环、速度控制与快捷键
- 标签页原声音频缓冲与语句切片
- 音频失败时自动降级为在线回放
- 本地 IndexedDB 语句库
- AI 翻译、语境查词与句子讲解
- Chrome 语音识别驱动的基础跟读评分
- 完整 JSON 备份与恢复

## 已知限制

- DRM 保护的视频可能无法捕获音频。
- 使用自绘字幕或画面硬字幕的网站需要额外适配器；MVP 不包含 OCR。
- YouTube/Bilibili 的页面结构可能调整，届时需要更新字幕选择器。
- 基础跟读评分衡量文本准确度、完整度和相对语速，不是音素级发音评价。
- Chrome 快捷键可能与操作系统或网站快捷键冲突，可在 `chrome://extensions/shortcuts` 修改。

## 开发

```bash
npm run test
npm run build
npm run check
```
