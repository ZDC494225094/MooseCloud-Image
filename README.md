# MooseCloud Image Playground

MooseCloud Image Playground 是一个面向图片生成场景的前端工作台，包含两个核心页面：

- `playground.html`：图片生成与任务管理工作台
- `index.html`：案例画廊，聚合展示公开图片 Prompt 案例

项目基于 `Vite + React + TypeScript + Zustand + Tailwind CSS` 构建，支持本地开发、静态构建、画廊数据同步，以及用 Node 静态服务快速预览产物。

## 功能概览

- 图片生成工作台
- 本地任务状态管理
- API URL / API Key 配置
- `images` / `responses` 两种接口模式切换
- 画廊案例浏览、搜索、分类和排序
- 从公开来源同步案例数据到本地 `public/data/cases.json`
- 构建后使用内置 Node 服务启动静态站点

## 技术栈

- React 19
- TypeScript
- Vite 6
- Zustand
- Tailwind CSS
- Vitest

## 目录结构

```text
.
├─ public/                  # 静态资源与画廊数据
├─ scripts/                 # 数据同步脚本
├─ src/                     # 前端源码
├─ assets/                  # 额外前端资源
├─ index.html               # 画廊入口
├─ playground.html          # 创作台入口
├─ server.mjs               # 本地静态服务
└─ package.json
```

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 启动开发环境

```bash
npm run dev
```

默认由 Vite 启动开发服务器。

### 3. 运行测试

```bash
npm test
```

监听模式：

```bash
npm run test:watch
```

### 4. 构建生产产物

```bash
npm run build
```

这个命令会按顺序执行：

1. `npm run sync-gallery`
2. TypeScript 编译
3. Vite 构建

### 5. 启动构建后的站点

```bash
npm start
```

默认访问地址：

```text
http://127.0.0.1:4173
```

如果 `dist/` 存在，服务会优先读取构建产物；否则会直接读取项目根目录下的静态文件。

## 可用脚本

```bash
npm run dev           # 本地开发
npm run sync-gallery  # 同步案例数据
npm run build         # 同步数据 + 编译 + 构建
npm run preview       # Vite 预览
npm start             # Node 静态服务
npm test              # 运行测试
npm run test:watch    # 测试监听
```

## 画廊数据同步

画廊数据由脚本 [`scripts/sync-gallery-data.mjs`](/F:/code/AICode/gpt-image-2-prompt/scripts/sync-gallery-data.mjs) 生成，并输出到 [`public/data/cases.json`](/F:/code/AICode/gpt-image-2-prompt/public/data/cases.json)。

当前同步脚本会聚合公开来源数据，包括：

- `awesome-gpt-image-2-prompts`
- OpenNana prompt gallery

可选环境变量：

```bash
OPENNANA_MAX_ITEMS=200
OPENNANA_CONCURRENCY=8
```

示例：

```bash
OPENNANA_MAX_ITEMS=100 npm run sync-gallery
```

在 Windows 环境下，脚本包含针对下载失败场景的 PowerShell 回退逻辑。

## 配置说明

应用内可通过设置面板配置以下内容：

- API URL
- API Key
- API 模式：`images` / `responses`
- 模型名称
- 请求超时
- 是否启用代理模式
- 是否启用 Codex CLI 模式

部分参数也支持通过 URL 查询参数覆盖：

- `apiUrl`
- `apiKey`
- `apiMode`
- `codexCli`
- `prompt`

例如：

```text
/playground.html?apiUrl=https://your-api.example.com&apiMode=images&prompt=hello
```

## 发布说明

当前仓库已同步到：

- GitHub: [ZDC494225094/MooseCloud-Image](https://github.com/ZDC494225094/MooseCloud-Image)

## License

仓库包含 [`LICENSE`](/F:/code/AICode/gpt-image-2-prompt/LICENSE) 文件，使用前请结合其中条款确认使用方式。
