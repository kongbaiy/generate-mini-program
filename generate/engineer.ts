import fs from 'node:fs'
import path from 'node:path'
import { parse } from '@babel/parser'

import { createPage } from './create'
import schemas from '../schemas/pages.json'

interface GenerateEngineerConfig {
    inputDir: string
    outputDir: string
    excludeFiles?: string[]
}

interface ProjectOptions {
    projectName: string
    copyFiles: (GenerateEngineerConfig | string)[]
    excludeFiles?: string[]
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
export const SCRIPT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue'])
export const STYLE_EXTENSIONS = new Set(['.css', '.less', '.scss', '.sass', '.styl'])

export const copied = new Set<string>()
export const SKIP_DIRS = new Set(['.git', 'node_modules', 'generated', 'dist', '.DS_Store'])

export const extractScriptSpecifiers = (code: string): string[] => {
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

export const resolveSpecifier = (
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

export const extractStyleSpecifiers = (code: string): string[] => {
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

export const dependenciesCollect = (
    projectName: string,
    abs: string,
    callback?: (resolved: any) => void
) => {
    const ext = path.extname(abs).toLowerCase()

    if (SCRIPT_EXTENSIONS.has(ext) || STYLE_EXTENSIONS.has(ext)) {
        const code = fs.readFileSync(abs, 'utf8')
        const specs = SCRIPT_EXTENSIONS.has(ext)
            ? extractScriptSpecifiers(code)
            : extractStyleSpecifiers(code)

        for (const spec of specs) {
            const resolved = resolveSpecifier(
                spec,
                abs.replace(`/generated/${projectName}`, ''),
                ALIAS,
                DEFAULT_EXTENSIONS
            )
            if (resolved) {
                callback?.(resolved)
            }
        }
    }
}

const copyRecursive = (src: string, dest: string, excludeFiles: string[] = []) => {
    if (!fs.existsSync(src)) {
        console.warn(`[skip] 源路径不存在: ${src}`)
        return
    }

    const abs = path.resolve(src)
    if (copied.has(abs)) return
    copied.add(abs)

    const stat = fs.lstatSync(abs)

    if (stat.isSymbolicLink()) {
        console.warn(`[skip] 符号链接: ${abs}`)
        return
    }

    if (stat.isDirectory()) {
        fs.mkdirSync(dest, { recursive: true })

        for (const item of fs.readdirSync(abs)) {
            if (SKIP_DIRS.has(item)) continue

            const exclude = excludeFiles.some((ex) => ex.includes(item))
            if (exclude) continue

            const childAbs = path.join(abs, item)
            const childStat = fs.lstatSync(childAbs)

            if (childStat.isSymbolicLink()) continue

            if (childStat.isDirectory()) {
                copyRecursive(childAbs, path.join(dest, item), excludeFiles)
                continue
            }

            if (!childStat.isFile()) continue

            const ext = path.extname(childAbs).toLowerCase()

            if (SCRIPT_EXTENSIONS.has(ext) || STYLE_EXTENSIONS.has(ext)) {
                const code = fs.readFileSync(childAbs, 'utf8')
                const specs = SCRIPT_EXTENSIONS.has(ext)
                    ? extractScriptSpecifiers(code)
                    : extractStyleSpecifiers(code)

                for (const spec of specs) {
                    const resolved = resolveSpecifier(spec, childAbs, ALIAS, DEFAULT_EXTENSIONS)
                    if (resolved) {
                        copyRecursive(
                            resolved,
                            path.join(dest, path.relative(abs, resolved)),
                            excludeFiles
                        )
                    }
                }
            }

            const childDest = path.join(dest, item)
            fs.mkdirSync(path.dirname(childDest), { recursive: true })
            fs.copyFileSync(childAbs, childDest)
        }
    } else {
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        fs.copyFileSync(abs, dest)
    }
}

export const generateEngineer = (config: GenerateEngineerConfig) => {
    copyRecursive(config.inputDir, config.outputDir, config.excludeFiles || [])
}

export const createProject = (options: ProjectOptions) => {
    const outputRootPath = path.join(rootPath, 'generated', options.projectName)

    if (!options.copyFiles.length) {
        fs.readdirSync(path.join(rootPath)).forEach((item) => {
            const exclude = options.excludeFiles?.some((ex) => ex.includes(item))

            if (SKIP_DIRS.has(item) || exclude) return

            const inputDir = path.join(rootPath, item)
            const outputDir = path.join(outputRootPath, item)

            generateEngineer({
                inputDir,
                outputDir,
                excludeFiles: options.excludeFiles,
            })
        })
        createPage({
            templates: schemas.pagesConfig.templates as any[],
            projectName: options.projectName,
        })

        return
    }

    options.copyFiles?.forEach((item) => {
        const inputDir = typeof item === 'string' ? item : item.inputDir
        const outputDir = typeof item === 'string' ? item : item.outputDir

        generateEngineer({
            inputDir: path.join(rootPath, inputDir),
            outputDir: path.join(outputRootPath, outputDir),
            excludeFiles: options.excludeFiles,
        })

        createPage({
            templates: schemas.pagesConfig.templates as any[],
            projectName: options.projectName,
        })
    })
}
