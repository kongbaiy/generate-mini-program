// 生成器:读 src/schemas/pages.json → 在 src/pages/ 下生成页面 .tsx + .config.ts → 重写 app.config.ts
// 依赖收集交给 Taro vite:生成的 .tsx 只写 import,样式/子组件/图片靠 vite 沿 import 链自动追踪打包。
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const SRC = path.join(ROOT, 'src')
const SCHEMA_PATH = path.join(SRC, 'schemas', 'pages.json')
const PAGES_DIR = path.join(SRC, 'pages')
const APP_CONFIG_PATH = path.join(SRC, 'app.config.ts')

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
// kebab/camel → PascalCase,用于组件名
const pascal = (s: string) => s.split(/[-_]/).filter(Boolean).map(cap).join('')

const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf-8'))
const pageNames: string[] = []

for (const page of schema.pages) {
    const dir = path.join(PAGES_DIR, page.name)
    fs.mkdirSync(dir, { recursive: true })

    // 去重模板,生成 import 语句
    const templates = [...new Set(page.blocks.map((b: Record<string, unknown>) => b.template))]
    const imports = templates
        .map((t) => `import ${pascal(String(t))} from '@/templates/${t}'`)
        .join('\n')

    // 渲染 blocks,props 用 spread 内联
    const blocks = page.blocks
        .map((b: { template: string; props: {} }) => {
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

// 重写 app.config.ts —— pages 数组从 JSON 派生,window 配置保留
const pagesArray = pageNames.map((p) => `    '${p}'`).join(',\n')
const appConfig = `export default defineAppConfig({
  pages: [
${pagesArray}
  ],
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#fff',
    navigationBarTitleText: 'WeChat',
    navigationBarTextStyle: 'black'
  }
})
`
fs.writeFileSync(APP_CONFIG_PATH, appConfig)

console.log(`✓ Generated ${pageNames.length} page(s):`)
pageNames.forEach((p) => console.log(`  - ${p}`))
