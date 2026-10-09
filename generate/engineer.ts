import fs from 'node:fs'
import path from 'node:path'
import { parse } from '@babel/parser'

interface GenerateEngineerConfig {
    inputDir: string
    outputDir: string
}

interface ProjectOptions {
    projectName: string
    copyFiles: (GenerateEngineerConfig | string)[]
}

const rootPath = process.cwd()

const ALIAS: Record<string, string[]> = {
    '@/': [path.join(rootPath, 'src') + path.sep],
}

const PARSER_PLUGINS: any[] = [
    'typescript',
    'jsx',
    'decorators-legacy',
    'classProperties',
    'classPrivateProperties',
    'classPrivateMethods',
    'dynamicImport',
    'importMeta',
    'topLevelAwait',
    'exportDefaultFrom',
    'exportNamespaceFrom',
]
const DEFAULT_EXTENSIONS = [
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.mjs',
    '.cjs',
    '.vue',
    '.json',
    '.css',
    '.less',
    '.scss',
    '.sass',
    '.styl',
    '.html',
    '.wxml',
    '.wxss',
    '.wxs',
    '.axml',
    '.acss',
    '.svg',
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.webp',
]
const SCRIPT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue'])
const STYLE_EXTENSIONS = new Set(['.css', '.less', '.scss', '.sass', '.styl'])

const extractScriptSpecifiers = (code: string): string[] => {
    const specs = new Set<string>()
    let ast: ReturnType<typeof parse>

    try {
        ast = parse(code, {
            sourceType: 'unambiguous',
            plugins: PARSER_PLUGINS,
            errorRecovery: true,
        })
    } catch (e) {
        console.warn('[warn] Babel 解析失败，跳过该文件:', (e as Error).message)
        return []
    }

    walkAst(ast, (node) => {
        // import / export ... from '...'
        if (
            (node.type === 'ImportDeclaration' ||
                node.type === 'ExportNamedDeclaration' ||
                node.type === 'ExportAllDeclaration') &&
            node.source?.type === 'StringLiteral'
        ) {
            specs.add(node.source.value)
            return
        }

        if (
            node.type === 'CallExpression' &&
            node.callee?.type === 'Identifier' &&
            node.callee.name === 'require' &&
            node.arguments?.[0]?.type === 'StringLiteral'
        ) {
            specs.add(node.arguments[0].value)
            return
        }

        // import('...')
        if (node.type === 'ImportExpression' && node.source?.type === 'StringLiteral') {
            specs.add(node.source.value)
            return
        }

        // new URL('./x', import.meta.url) —— Vite 风格资源引用
        if (
            node.type === 'NewExpression' &&
            node.callee?.type === 'Identifier' &&
            node.callee.name === 'URL' &&
            node.arguments?.[0]?.type === 'StringLiteral' &&
            node.arguments?.[1]?.type === 'MetaProperty'
        ) {
            specs.add(node.arguments[0].value)
        }
    })

    return [...specs]
}

const walkAst = (node: any, visit: (n: any) => void) => {
    if (!node || typeof node !== 'object') return

    if (Array.isArray(node)) {
        for (const item of node) walkAst(item, visit)
        return
    }

    if (typeof node.type === 'string') visit(node)

    for (const key of Object.keys(node)) {
        if (
            key === 'loc' ||
            key === 'range' ||
            key === 'leadingComments' ||
            key === 'trailingComments' ||
            key === 'innerComments' ||
            key === 'comments' ||
            key === 'tokens' ||
            key === 'errors'
        )
            continue

        const child = node[key]
        if (child && typeof child === 'object') walkAst(child, visit)
    }
}

const resolveSpecifier = (
    spec: string,
    fromFile: string,
    alias: Record<string, string[]>,
    extensions: string[]
): string | null => {
    // 1. 相对路径
    if (spec.startsWith('.')) {
        const base = path.resolve(path.dirname(fromFile), spec)
        return tryResolve(base, extensions)
    }

    // 2. 别名匹配（@ / @xxx / 自定义）
    //    按 key 长度倒序，优先匹配更具体的别名（如 @components/ 优先于 @/）
    const aliasKeys = Object.keys(alias).sort((a, b) => b.length - a.length)
    for (const key of aliasKeys) {
        const clean = key.replace(/\/\*$/, '')
        if (spec === clean || spec.startsWith(clean + '/')) {
            const rest = spec === clean ? '' : spec.slice(clean.length + 1)
            for (const target of alias[key]) {
                const targetClean = target.replace(/\/\*$/, '')
                const found = tryResolve(path.resolve(targetClean, rest), extensions)
                if (found) return found
            }
        }
    }

    // 3. 裸包名（react、antd...）跳过
    return null
}

const tryResolve = (base: string, extensions: string[]): string | null => {
    if (isFile(base)) return base

    for (const ext of extensions) {
        if (isFile(base + ext)) return base + ext
    }

    for (const ext of extensions) {
        const idx = path.join(base, 'index' + ext)
        if (isFile(idx)) return idx
    }

    return null
}

const isFile = (p: string) => {
    try {
        return fs.statSync(p).isFile()
    } catch {
        return false
    }
}

const extractStyleSpecifiers = (code: string): string[] => {
    const specs = new Set<string>()

    // 去注释
    const cleaned = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

    // @import 'xxx' / @use 'xxx' / @forward 'xxx'
    const atRule = /@(?:import|use|forward)\s+(?:url\()?['"]([^'"]+)['"]/g
    let m: RegExpExecArray | null
    while ((m = atRule.exec(cleaned))) {
        // 跳过 http(s):// 与 data: 等外部资源
        if (/^(?:https?:)?\/\//.test(m[1]) || m[1].startsWith('data:')) continue
        specs.add(m[1])
    }

    // url('xxx') —— 只收集本地相对路径
    const urlRe = /url\(\s*['"]?([^'")]+)['"]?\s*\)/g
    while ((m = urlRe.exec(cleaned))) {
        const v = m[1].trim()
        if (/^(?:https?:)?\/\//.test(v) || v.startsWith('data:') || v.startsWith('#')) continue
        specs.add(v)
    }

    return [...specs]
}

const copyRecursive = (src: string, dest: string) => {
    if (!fs.existsSync(src)) {
        console.warn(`[skip] 源路径不存在: ${src}`)
        return
    }

    const stat = fs.statSync(src)
    const dependenciesPath = new Set<string>()

    if (stat.isDirectory()) {
        fs.mkdirSync(dest, { recursive: true })

        for (const item of fs.readdirSync(src)) {
            const abs = path.join(src, item)
            const code = fs.readFileSync(abs, 'utf8')
            const ext = path.extname(abs).toLowerCase()

            // 脚本文件：解析 import / require / 动态 import
            if (SCRIPT_EXTENSIONS.has(ext)) {
                for (const spec of extractScriptSpecifiers(code)) {
                    const resolved = resolveSpecifier(spec, abs, ALIAS, DEFAULT_EXTENSIONS)

                    if (resolved && !dependenciesPath.has(resolved)) {
                        dependenciesPath.add(resolved)
                        copyRecursive(resolved, path.join(dest, path.relative(src, resolved)))
                    }
                }
            }

            // 样式文件：解析 @import / @use / @forward / url()
            if (STYLE_EXTENSIONS.has(ext)) {
                for (const spec of extractStyleSpecifiers(code)) {
                    const resolved = resolveSpecifier(spec, abs, ALIAS, DEFAULT_EXTENSIONS)

                    if (resolved && !dependenciesPath.has(resolved)) {
                        dependenciesPath.add(resolved)
                        copyRecursive(resolved, path.join(dest, path.relative(src, resolved)))
                    }
                }
            }

            const srcPath = path.join(src, item)
            if (!dependenciesPath.has(srcPath)) {
                dependenciesPath.add(srcPath)
                copyRecursive(srcPath, path.join(dest, item))
            }
        }
    } else {
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        fs.copyFileSync(src, dest)
    }
}

export const generateEngineer = (config: GenerateEngineerConfig) => {
    copyRecursive(config.inputDir, config.outputDir)
}

export const createProject = (options: ProjectOptions) => {
    const outputRootPath = path.join(rootPath, 'generated', options.projectName)

    options.copyFiles?.forEach((item) => {
        const inputDir = typeof item === 'string' ? item : item.inputDir
        const outputDir = typeof item === 'string' ? item : item.outputDir

        generateEngineer({
            inputDir: path.join(rootPath, inputDir),
            outputDir: path.join(outputRootPath, outputDir),
        })
    })
}
