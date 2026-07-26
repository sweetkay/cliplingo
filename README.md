# ClipLingo

ClipLingo 是一款面向个人使用的 Chrome / Edge 英语视频学习插件。它能识别网页视频字幕、显示双语翻译、保存当前语句及原声，并提供 MiniMax AI 示范音、跟读评分、口语教练和本地语句库。

## 安装

1. 在 GitHub Releases 下载最新的 ClipLingo 安装包。
2. 解压 ZIP。
3. Chrome 打开 `chrome://extensions`，Edge 打开 `edge://extensions`。
4. 开启“开发者模式”。
5. 点击“加载已解压的扩展程序”，选择解压后的文件夹。
6. 刷新已经打开的视频网页。

详细步骤见 [public/INSTALL.md](public/INSTALL.md)。

## 配置 MiniMax

打开插件设置，填写 MiniMax 开放平台 API Key。默认配置：

- API Base URL：`https://api.minimaxi.com/v1`
- 口语教练：`MiniMax-M2.7`
- AI 示范音：`speech-2.8-turbo`
- 英语音色：`English_Graceful_Lady`
- 翻译：Chrome 本地翻译，失败时回退到 MiniMax

同一个 Key 用于示范音、口语教练、查词和字幕翻译，只保存在浏览器本地。

## v0.3 功能

- 通用 HTML5、YouTube、Bilibili 字幕识别
- Chrome 端侧翻译与 MiniMax 回退
- 双语悬浮字幕
- 单句循环、倍速播放和原声收藏
- MiniMax Speech 2.8 AI 示范发音
- 可从 MiniMax 读取系统、复刻和文生音色 Voice ID
- 点击查词
- Chrome 语音识别
- 本地准确度、完整度、流利度、节奏和语调评分
- 可选 MiniMax 文本模型生成中文口语教练反馈
- IndexedDB 本地语句库和 JSON 备份
- 语句库 AI 示范音播放、单句循环和跟读评分
- 支持读取 MiniMax 账户下可用的 Voice ID
- 语音模型与字幕翻译模型独立选择

## 隐私

- 收藏语句、原声音频、设置和 API Key 保存在浏览器本地。
- 生成示范音时，当前台词会发送给 MiniMax。
- 生成教练反馈时，仅发送目标台词、Chrome 识别文字及本地统计分数。
- 麦克风只在点击“跟读”后启用；录音不保存，也不会上传到 MiniMax。
- 插件不会上传完整视频。

## 开发

```bash
npm install
npm run check
```

构建产物位于 `dist/`。

## 已知限制

- Chrome 端侧 Translator API 需要较新的桌面版 Chrome，并可能首次下载语言包。
- Chrome 语音识别的可用性受浏览器、地区和网络环境影响。
- 本地语调分数用于练习反馈，不是音素级专业考试评分。
- 不同视频网站的自绘字幕可能需要额外适配。
- 自定义人物音色需先在 MiniMax 创建 Voice ID，并确保拥有声音使用授权。
