# Taro 项目级脚手架生成器

## Context

当前仓库有一个页面级生成器 `generate/page.ts`,能在现有项目里根据 `src/schemas/pages.json` 生成页面。用户要把它升级成项目级脚手架(低代码):输入一个完整描述整个小程序的 JSON,输出一个**完整的、可独立 `taro build` 的 Taro 项目**到 `generated/<name>/`,新项目完全独立(自带模板、自带依赖声明),复制模板进去后即可打包。

用户已对齐 4 个决策:
1. 产物放 `generated/<name>/` 子目录
2. JSON schema 扩展为完整项目配置(project/window/tabBar/pages)
3. 模板从宿主 `src/templates/` 复制到新项目内,使其独立可打包
4. 生成器留在当前仓库 `generate/`,新项目不含生成器代码(重新生成走宿主 `generate:project` 幂等覆盖整目录;低代码场景下生成代码不应手改,要改就改 schema 或模板)

## 方案

### 1. 新建 schema:`src/schemas/project.json`

完整项目描述,示例:
```json
{
  "project": {
    "name": "my-applet",
    "description": "我的小程序",
    "appid": "wx1234567890abcdef"
  },
  "window": {
    "backgroundTextStyle": "light",
    "navigationBarBackgroundColor": "#fff",
    "navigationBarTitleText": "WeChat",
    "navigationBarTextStyle": "black"
  },
  "pages": [
    {
      "name": "home",
      "title": "首页",
      "blocks": [
        { "template": "Hero", "props": { "title": "欢迎" } }
      ]
    }
  ]
}
```
保留现有 `pages.json` 不动(向后兼容 `page.ts`)。`tabBar` 字段可选——schema 有则写入 `app.config.ts`,无则不写该键。首版示例 schema 里 `blocks` 先放空数组(因为宿主 `src/templates/` 当前为空),用户后续添加模板再填 blocks。

### 2. 新建生成器:`generate/project.ts`(ESM TS,Node 22 类型剥离运行)

复用 [generate/page.ts](file:///Users/kanglu/Downloads/web/小程序/applet-platform/generate/page.ts) 的 `cap`/`pascal`/blocks→tsx 渲染/pages 派生 4 段逻辑(内联,不抽公共——因为新项目目录结构不同)。模块流程:

1. 读 `src/schemas/project.json` → 解析
2. **模板存在性校验**:`Set` 收集 `pages[].blocks[].template` 去重,逐个检查宿主 `src/templates/<Name>/` 存在;缺失则 `throw Error` 列出全部缺失名,中断
3. `OUT = generated/<schema.project.name>/`;`fs.rmSync(OUT,{recursive:true,force:true})` → `mkdirSync(OUT,{recursive:true})`
4. 逐文件写入(见清单)
5. `fs.cpSync(hostSrc/templates/<Name>, OUT/src/templates/<Name>, {recursive:true})` 复制每个用到的模板
6. 打印下一步:`cd generated/<name> && pnpm install && pnpm build:weapp`
7. **不自动 install**(慢、需网络)

### 3. 生成文件清单(目标 `generated/<name>/`)

| 文件 | 来源 |
|---|---|
| `package.json` | 模板字符串:`name`/`description` 取自 schema;deps 从宿主 package.json 复制;scripts 去掉 `generate`/`new`(新项目无生成器),保留 build/dev 全平台 + `prepare`(husky);保留 browserslist、templateInfo |
| `pnpm-workspace.yaml` | 直接复制(allowBuilds) |
| `tsconfig.json` | 复制,但 `include` 去掉 `"./generate"` |
| `babel.config.js` | 直接复制(CJS,**根不能加 type:module**) |
| `config/index.ts` | 模板:`projectName`=schema.name,`date`=`new Date().toISOString().slice(0,10)`,**alias 修复为 `path.resolve(__dirname, '../src')`**(避坑 #1) |
| `config/dev.ts` `config/prod.ts` | 直接复制 |
| `project.config.json` | 模板:`projectname`=schema.name,`appid`=schema.appid,`description`=schema.description |
| `src/app.ts` | 直接复制 |
| `src/app.scss` | 空文件 |
| `src/index.html` | 模板:`<title>` 换成 schema.name |
| `src/app.config.ts` | 模板:pages 从 schema.pages 派生,window 从 schema,tabBar 可选(有则写) |
| `src/pages/<name>/index.tsx` + `index.config.ts` | 内联 page.ts 的渲染逻辑生成 |
| `src/templates/<Name>/` | `fs.cpSync` 从宿主复制 |
| `commitlint.config.mjs` `stylelint.config.mjs` | 首版跳过(非必须,降低噪音) |

**不生成** `generate/` 目录、`generate/package.json`(新项目无生成器)。

### 4. 宿主改动

- `package.json` 加脚本:`"generate:project": "node generate/project.ts"`(放现有 `generate` 之后)
- `.gitignore` 加 `generated/`(产物不入库)

### 5. 关键避坑

1. `config/index.ts` 的 `alias` 必须是 `path.resolve(__dirname, '../src')`——宿主当前是 `'src'` 会解析到 `config/src/` 导致所有 `@/templates/*` import 失败。生成器写新项目时必须用修复版。
2. 宿主根 `package.json` 不能加 `"type":"module"`(`babel.config.js` 是 CJS)。生成器继续靠 `generate/package.json` 的 `{type:module}` 局部生效;**新项目根 package.json 同样不加 type:module**。
3. 新项目 `tsconfig.json` 的 `include` 去掉 `"./generate"`(目录不存在)。
4. `config/index.ts` 的 `date` 用 `YYYY-MM-DD` 格式(Taro 校验)。
5. `project.config.json` 的 `appid` 从 schema 必填,不留 `touristappid` 默认。

### 6. 验证

1. 宿主 `pnpm generate:project` → 控制台列出已生成页面 + 复制模板数 + 下一步指令
2. `ls -R generated/<name>/` 核对目录树
3. `cd generated/<name> && pnpm install`
4. `pnpm build:weapp` 必须 0 错误独立产出 `dist/`——这是 alias 修复 + 模板复制链是否成功的关键验证
5. 抽查 `dist/pages/home/index.js` 存在,确认页面产物落地

## 关键复用文件

- [generate/page.ts](file:///Users/kanglu/Downloads/web/小程序/applet-platform/generate/page.ts):复用页面渲染逻辑(`cap`/`pascal`/blocks→tsx/pages 派生)
- [config/index.ts](file:///Users/kanglu/Downloads/web/小程序/applet-platform/config/index.ts):alias 坑修复模板源
- [package.json](file:///Users/kanglu/Downloads/web/小程序/applet-platform/package.json):依赖清单复制源 + 宿主脚本新增位置
- [src/app.config.ts](file:///Users/kanglu/Downloads/web/小程序/applet-platform/src/app.config.ts):pages/window/tabBar 派生参考
- [tsconfig.json](file:///Users/kanglu/Downloads/web/小程序/applet-platform/tsconfig.json):include 调整参考
