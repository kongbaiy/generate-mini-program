// 项目级脚手架:读 src/schemas/project.json → 在 generated/<name>/ 生成完整可独立 build 的 Taro 项目
// 复用 page.ts 的页面渲染逻辑(内联)。模板从宿主 src/templates/ 复制到新项目,使其独立可打包。
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const SRC = path.join(ROOT, 'src')
const SCHEMA_PATH = path.join(SRC, 'schemas', 'project.json')
const TEMPLATES_SRC = path.join(SRC, 'templates')

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const pascal = (s: string) => s.split(/[-_]/).filter(Boolean).map(cap).join('')
// JSON.stringify 的多行输出缩进:首行不缩进(紧跟在 `key: ` 后),后续行加前缀
const indent = (s: string, prefix: string) =>
    s
        .split('\n')
        .map((l, i) => (i === 0 ? l : prefix + l))
        .join('\n')

interface Block {
    template: string
    props?: Record<string, unknown>
}
interface PageSchema {
    name: string
    title?: string
    blocks: Block[]
}
interface ProjectSchema {
    project: {
        name: string
        description?: string
        appid: string
    }
    window?: Record<string, unknown>
    tabBar?: Record<string, unknown>
    pages: PageSchema[]
}

const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf-8')) as ProjectSchema

// 1. 模板存在性校验
const templateNames = new Set<string>()
for (const page of schema.pages) {
    for (const block of page.blocks) {
        templateNames.add(block.template)
    }
}
const missing = [...templateNames].filter((t) => !fs.existsSync(path.join(TEMPLATES_SRC, t)))
if (missing.length > 0) {
    throw new Error(`缺失模板(在 ${TEMPLATES_SRC} 下找不到): ${missing.join(', ')}`)
}

// 2. 准备输出目录
const projectName = schema.project.name
const OUT = path.join(ROOT, 'generated', projectName)
const OUT_SRC = path.join(OUT, 'src')
fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT_SRC, { recursive: true })
fs.mkdirSync(path.join(OUT, 'config'), { recursive: true })

const today = new Date().toISOString().slice(0, 10)
const hostPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'))

// 3. package.json —— 复制依赖,改 name/description,去 generate/new 脚本(新项目无生成器)
const newPkg: Record<string, unknown> = { ...hostPkg }
newPkg.name = projectName
newPkg.description = schema.project.description || ''
const scripts = { ...(hostPkg.scripts as Record<string, string>) }
delete scripts.generate
delete scripts.new
newPkg.scripts = scripts
fs.writeFileSync(path.join(OUT, 'package.json'), JSON.stringify(newPkg, null, 2) + '\n')

// 4. 直接复制的文件
fs.cpSync(path.join(ROOT, 'types/global.d.ts'), path.join(OUT, 'types/global.d.ts'))
fs.cpSync(path.join(ROOT, 'pnpm-workspace.yaml'), path.join(OUT, 'pnpm-workspace.yaml'))
fs.cpSync(path.join(ROOT, 'commitlint.config.mjs'), path.join(OUT, 'commitlint.config.mjs'))
fs.cpSync(path.join(ROOT, '.prettierrc'), path.join(OUT, '.prettierrc'))
fs.cpSync(path.join(ROOT, '.eslintrc'), path.join(OUT, '.eslintrc'))
fs.cpSync(path.join(ROOT, '.env.development'), path.join(OUT, '.env.development'))
fs.cpSync(path.join(ROOT, '.env.test'), path.join(OUT, '.env.test'))
fs.cpSync(path.join(ROOT, '.env.production'), path.join(OUT, '.env.production'))
fs.cpSync(path.join(ROOT, '.editorconfig'), path.join(OUT, '.editorconfig'))
fs.cpSync(path.join(ROOT, 'babel.config.js'), path.join(OUT, 'babel.config.js'))
fs.cpSync(path.join(ROOT, 'config/dev.ts'), path.join(OUT, 'config/dev.ts'))
fs.cpSync(path.join(ROOT, 'config/prod.ts'), path.join(OUT, 'config/prod.ts'))
fs.cpSync(path.join(ROOT, 'src/app.ts'), path.join(OUT_SRC, 'app.ts'))
fs.writeFileSync(path.join(OUT_SRC, 'app.scss'), '')

// 5. tsconfig.json —— 复制(含注释,不走 JSON.parse),include 去掉 ./generate
let tsconfigStr = fs.readFileSync(path.join(ROOT, 'tsconfig.json'), 'utf-8')
tsconfigStr = tsconfigStr.replace(/,\s*"\.\/generate"/, '')
fs.writeFileSync(path.join(OUT, 'tsconfig.json'), tsconfigStr)

// 6. config/index.ts —— projectName/date 来自 schema/今天,alias 修复为 ../src(避坑:__dirname 是 config/)
const configIndex = `import { defineConfig, type UserConfigExport } from '@tarojs/cli'
import path from 'path'

import devConfig from './dev'
import prodConfig from './prod'

export default defineConfig<'vite'>(async (merge) => {
    const baseConfig: UserConfigExport<'vite'> = {
        projectName: ${JSON.stringify(projectName)},
        date: ${JSON.stringify(today)},
        designWidth: 750,
        deviceRatio: {
            640: 2.34 / 2,
            750: 1,
            375: 2,
            828: 1.81 / 2,
        },
        sourceRoot: 'src',
        outputRoot: 'dist',
        plugins: ['@tarojs/plugin-generator'],
        defineConstants: {},
        copy: {
            patterns: [],
            options: {},
        },
        framework: 'react',
        compiler: 'vite',
        alias: {
            '@': path.resolve(__dirname, '../src'),
        },
        mini: {
            postcss: {
                pxtransform: {
                    enable: true,
                    config: {},
                },
                cssModules: {
                    enable: true,
                    config: {
                        namingPattern: 'module',
                        generateScopedName: '[name]__[local]___[hash:base64:5]',
                    },
                },
            },
        },
        h5: {
            publicPath: '/',
            staticDirectory: 'static',
            miniCssExtractPluginOption: {
                ignoreOrder: true,
                filename: 'css/[name].[hash].css',
                chunkFilename: 'css/[name].[chunkhash].css',
            },
            postcss: {
                autoprefixer: {
                    enable: true,
                    config: {},
                },
                cssModules: {
                    enable: true,
                    config: {
                        namingPattern: 'module',
                        generateScopedName: '[name]__[local]___[hash:base64:5]',
                    },
                },
            },
        },
        rn: {
            appName: 'taroDemo',
            postcss: {
                cssModules: {
                    enable: false,
                },
            },
        },
    }

    process.env.BROWSERSLIST_ENV = process.env.NODE_ENV

    if (process.env.NODE_ENV === 'development') {
        return merge({}, baseConfig, devConfig)
    }
    return merge({}, baseConfig, prodConfig)
})
`
fs.writeFileSync(path.join(OUT, 'config/index.ts'), configIndex)

// 7. project.config.json —— appid/projectname/description 来自 schema
const projectConfig = {
    miniprogramRoot: './dist',
    projectname: projectName,
    description: schema.project.description || '',
    appid: schema.project.appid,
    setting: {
        urlCheck: true,
        es6: false,
        enhance: false,
        compileHotReLoad: false,
        postcss: false,
        minified: false,
    },
    compileType: 'miniprogram',
}
fs.writeFileSync(
    path.join(OUT, 'project.config.json'),
    JSON.stringify(projectConfig, null, 2) + '\n'
)

// 8. src/index.html —— title 来自 schema
const indexHtml = `<!DOCTYPE html>
<html>
<head>
  <meta content="text/html; charset=utf-8" http-equiv="Content-Type">
  <meta content="width=device-width,initial-scale=1,user-scalable=no" name="viewport">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-touch-fullscreen" content="yes">
  <meta name="format-detection" content="telephone=no,address=no">
  <meta name="apple-mobile-web-app-status-bar-style" content="white">
  <meta http-equiv="X-UA-Compatible" content="IE=edge,chrome=1" >
  <title>${projectName}</title>
  <script><%= htmlWebpackPlugin.options.script %></script>
</head>
<body>
  <div id="app"></div>
</body>
</html>
`
fs.writeFileSync(path.join(OUT_SRC, 'index.html'), indexHtml)

// 9. 页面生成(复用 page.ts 逻辑)—— 生成 src/pages/<name>/index.tsx + index.config.ts
const PAGES_DIR = path.join(OUT_SRC, 'pages')
fs.mkdirSync(PAGES_DIR, { recursive: true })
const pageNames: string[] = []

for (const page of schema.pages) {
    const dir = path.join(PAGES_DIR, page.name)
    fs.mkdirSync(dir, { recursive: true })

    const templates = [...new Set(page.blocks.map((b) => b.template))]
    const imports = templates.map((t) => `import ${pascal(t)} from '@/templates/${t}'`).join('\n')

    const blocks = page.blocks
        .map((b) => {
            const name = pascal(b.template)
            const hasProps = b.props && Object.keys(b.props).length > 0
            const propsStr = hasProps ? ` {...${JSON.stringify(b.props)}}` : ''
            return `      <${name}${propsStr} />`
        })
        .join('\n')

    const tsx = `
import { useLoad } from '@tarojs/taro'
${imports}

export default function ${pascal(page.name)}() {
  useLoad(() => {})
  return (
    <>
${blocks}
    </>
  )
}
`
    fs.writeFileSync(path.join(dir, 'index.tsx'), tsx)

    const config = `export default {
  navigationBarTitleText: ${JSON.stringify(page.title || '')}
}
`
    fs.writeFileSync(path.join(dir, 'index.config.ts'), config)

    pageNames.push(`pages/${page.name}/index`)
}

// 10. app.config.ts —— pages 派生,window 来自 schema,tabBar 可选
const pagesArray = pageNames.map((p) => `    '${p}'`).join(',\n')
const windowJson = schema.window ? indent(JSON.stringify(schema.window, null, 2), '  ') : '{}'
const tabBarJson = schema.tabBar
    ? `,\n  tabBar: ${indent(JSON.stringify(schema.tabBar, null, 2), '  ')}`
    : ''
const appConfig = `export default defineAppConfig({
  pages: [
${pagesArray}
  ],
  window: ${windowJson}${tabBarJson}
})
`
fs.writeFileSync(path.join(OUT_SRC, 'app.config.ts'), appConfig)

// 11. 复制模板到新项目
const OUT_TEMPLATES = path.join(OUT_SRC, 'templates')
fs.mkdirSync(OUT_TEMPLATES, { recursive: true })
for (const t of templateNames) {
    fs.cpSync(path.join(TEMPLATES_SRC, t), path.join(OUT_TEMPLATES, t), { recursive: true })
}

// 12. 完成提示
console.log(`✓ Generated project: generated/${projectName}/`)
console.log(`  - ${pageNames.length} page(s): ${pageNames.join(', ')}`)
console.log(
    `  - ${templateNames.size} template(s) copied${templateNames.size > 0 ? ': ' + [...templateNames].join(', ') : ''}`
)
console.log('')
console.log('Next steps:')
console.log(`  cd generated/${projectName}`)
console.log('  pnpm install')
console.log('  pnpm build:weapp')
