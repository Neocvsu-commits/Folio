# 对页 · Folio 0.1.0

把英文 EPUB 制作为短句组英中对照书，在微信读书或其他 EPUB 阅读器中阅读。Windows 10/11 x64 桌面应用，实体书视觉与玻璃工具栏。

![制书台](screenshots/界面预览.png)

## 界面预览

制书台提供浅色与深色两套主题，导入原书后右侧书籍随翻译进度生长：

| 正常模式 | 暗夜模式 |
| :--- | :--- |
| ![正常模式](screenshots/正常模式.png) | ![暗夜模式](screenshots/暗夜模式.png) |

短句组对照效果（应用内预览，模拟手机排版；实际字体与分页由阅读器决定）：

![译文对照](screenshots/译文对照.png)

## 使用

1. 打开 `Folio-0.1.0-Windows.exe`。这是免安装版，首次解包需要几秒。
2. 点右上角“连接翻译模型”。DeepSeek 已预填服务地址 `https://api.deepseek.com`、模型 `deepseek-flash`。填入自己的密钥，测试连接并保存。模型名可直接编辑。
3. 拖入 EPUB，或点击左侧书籍。
4. 默认每组原文不超过 40 个词，可以在 15–100 词之间调整。优先保留完整句子；特别长的句子先按分句、再按词边界拆分。
5. “先试译 8 组”，在“对照预览”选择有正文的章节查看效果。满意后翻译全书。
6. 完成后将右侧书籍拖到资源管理器/桌面，或“另存为 EPUB”。点击右侧书籍可选择封面，也可按书名打开浏览器图片搜索，下载图片后再选择。
7. 使用微信读书官方网页的传书入口上传，或在手机上用微信读书打开 EPUB。客户端入口及最终字体、分页以微信读书当前版本为准。

试译只保留前 8 个对照单元的结果，未完成全书时不导出。暂停、关闭或请求失败后，已完成的结果会自动保存。重启应用会尝试打开上次的原书；原文件被移动时重新导入即可。

## 模型接口

支持兼容 OpenAI Chat Completions 的服务，包括 DeepSeek、自定义网关，以及提供该协议的 Ollama / LM Studio。

| 配置 | 说明 |
| --- | --- |
| 服务地址 | 例如 `https://api.deepseek.com` 或 `https://provider.example/v1`。自动补充 `/chat/completions`，已经填写完整地址时不会重复补充。 |
| 模型 | 服务商提供的模型 ID，不在代码中绑定。 |
| 密钥 | 在应用内填写。远程接口使用 HTTPS，本机回环地址可以使用 HTTP。 |
| 翻译偏好 | 可以填写风格要求、术语映射等。 |
| 并发 | 1–4，默认 2。额度不足或限流时可调低。 |

每批最多 8 组原文，包含相邻原文上下文。请求要求返回带原始编号的 JSON；程序验证编号、完整性、重复、空白和截断。格式不对或临时失败最多请求 3 次，不把错误结果写进书里。测试连接、重试、正式翻译均可能产生 API 费用；实际计费以服务商为准。

接入其他协议时，在 `src/core/provider.ts` 扩展请求层；`translateBatch` 返回 `{ translations, input, output }`，其中 `translations` 是单元 ID 到中文的映射。EPUB 处理、缓存、桌面 UI 不需要知道具体模型协议。当前没有开放 HTTP 服务端口；“API 接入”指应用调用外部模型的配置与适配层。

DeepSeek 预填值核对日期：2026-10-08。[官方接口文档](https://api-docs.deepseek.com/zh-cn/)。未使用真实付费密钥实测，接口联调使用本机模拟服务。

## 文件与处理边界

- 原书不被覆盖。保留原 EPUB 的清单、目录层级、资源路径、图片、样式和原文行内标记；只在正文中加入对应译文，并调整双语书标题和必要元数据。
- 英文的原有斜体、链接等标记会尽量保留在切分后的原文中；新增中文是纯文本，不会自动复制英文内部的粗体/斜体位置。
- 按阅读顺序处理正文和标题，保留原始导航目录文字。跳过导航页、代码块、公式、图片里的字和标记为不翻译的内容。当前面向英文到简体中文。
- 不支持内容加密、扫描图版或固定版式 EPUB；单文件上限 200 MB，解压后上限 450 MB。
- 全书排版采用“短原文在上、对应中文在下”。并排校对只用于应用内预览。微信读书实机导入仍需用用户的实际书籍验证，不能承诺与预览的字体、行距、分页完全一致。
- 模型、服务地址、翻译偏好或对照长度改变时，使用独立缓存，避免混用旧译文。切回之前的配置可以恢复其进度。
- 书籍本地解析。进行试译/翻译时，原文与上下文发送到用户选择的模型服务；查找封面会用书名和作者打开 Bing 图片搜索。
- 数据目录为 `%APPDATA%\Folio`：`settings.json` 存设置及 Windows 加密的密钥，`progress` 存译文缓存，`covers` 存替换封面，`exports` 存已完成的双语书。密钥不进入 EPUB 或源码。

## 现成工程调研

| 项目 | 可直接使用的部分 | 与本工具需求的关系 |
| --- | --- | --- |
| [BabelEbook](https://github.com/nevertiree/babel-ebook) | Windows 桌面版、DeepSeek、多模型、双语输出；MIT | 最接近的现成应用，原有交互更偏通用翻译工作台。 |
| [Ebook Translator for Calibre](https://github.com/bookfere/Ebook-Translator-Calibre-Plugin) | Calibre 内翻译、缓存、多种引擎、自定义引擎；GPL-3.0 | 适合已使用 Calibre 的用户，依赖 Calibre 的界面与工作流。 |
| [bilingual_book_maker](https://github.com/yihong0618/bilingual_book_maker) | 命令行制作双语 EPUB、多模型接口 | 适合脚本流程，实体书桌面交互需要另外实现。 |
| [BookTranslator](https://www.booktranslator.app/zh-CN/epub-translator) | 在线翻译、双语输出 | 是在线服务，不能作为本地桌面工程直接接入。 |

这份交付是独立实现，使用 JSZip / JSDOM 处理 EPUB，没有把上面三个项目整体嵌入应用。这样能直接控制“短句组对照”、封面和桌面拖出，并保留原 EPUB 包结构。调研仓库仅作为方案比较，未向上游提交或发布代码。

## 开发与构建

Node.js 22.12+、npm、Windows x64。

```powershell
npm install
# npm 若未运行 Electron 安装脚本，再执行下一行
node node_modules/electron/install.js
npm run typecheck
npm test
npm run build
npm start
npm run package
```

`npm run package` 生成 `release/Folio-0.1.0-Windows.exe`。`npm run dev` 仅用于前端开发；完整导入与导出需在 Electron 中运行。

```powershell
npx tsx scripts/sample.ts
npm run smoke
node scripts/verify-portable.mjs release/Folio-0.1.0-Windows.exe
```

主要结构：

- `src/core/segment.ts`：句子/分句切分、原文标记切片。
- `src/core/epub.ts`：EPUB 读取、结构保留、封面、双语导出。
- `src/core/provider.ts`：模型调用、响应校验与重试。
- `src/core/engine.ts`：任务状态、进度、缓存、暂停续译。
- `src/desktop`：后台 Worker、Windows 密钥保护、文件对话框与原生拖出。
- `src/ui`：React 视图、样式、模型设置、阅读预览。

测试使用临时数据目录与本机接口，不读取用户保存的模型密钥。`FOLIO_TEST_DATA`、`FOLIO_HEADLESS` 仅用于隔离测试；普通使用不需要设置。

交付验证（2026-10-08）：TypeScript 类型检查通过；6 项核心测试通过；打包后的 Windows 应用完成模型设置、模拟接口、密钥加密、导入、长度调整、试译、预览、续译、导出、封面替换/撤销与主题切换联调，渲染进程无报错。原生拖出已验证事件与导出文件路径的对接，真实资源管理器落点由用户操作验证。免安装 EXE 已独立验证启动。真实付费模型请求与微信读书实机导入未验证。

## 第三方组件

Electron、React、JSDOM、JSZip、entities、lucide-react 等组件按各自许可证分发。完整依赖版本见 `package-lock.json`，依赖许可证随应用依赖保留。示例 EPUB 中的英文、中文和封面为本项目原创测试素材。
