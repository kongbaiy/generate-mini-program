import fs from 'node:fs'
import path from 'node:path'
import { parse } from '@babel/parser'

import { createPage } from './create'
import schemas from '../schemas/pages.json'

/* ============================================================
 * 类型
 * ============================================================ */

type DirMode = 'copy' | 'entry'

interface GenerateEngineerConfig {
    inputDir: string
    /**
     * 输出根目录。
     * 源文件按"相对项目根目录的路径"镜像到此目录下。
     * 例如 outputRoot = /proj/generated/test，
     * 则 /proj/src/pages/home/index.tsx → /proj/generated/test/src/pages/home/index.tsx
     */
    outputRoot: string
    excludeFiles?: string[]
    maxDepth?: number
    dirMode?: DirMode
}

interface ProjectOptions {
    projectName: string
    copyFiles: (GenerateEngineerConfig | string)[]
    excludeFiles?: string[]
    /** 生成前是否清空整个 generated 目录，默认 true */
    clean?: boolean
    maxDepth?: number
    dirMode?: DirMode
}

/* ============================================================
 * 常量
 * ============================================================ */

const rootPath = process.cwd()
const GENERATED_DIR = 'generated'
const GENERATED_ROOT = path.join(rootPath, GENERATED_DIR)

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

export const SKIP_DIRS = new Set([
    '.git',
    '.vscode',
    'node_modules',
    'generated',
    'dist',
    '.DS_Store',
    '.swc',
])

export const SKIP_FILES = new Set([
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'package-lock.json',
    'yarn.lock',
    '.DS_Store',
])

const ENTRY_FILENAMES = new Set([
    'app.ts',
    'app.tsx',
    'app.js',
    'app.jsx',
    'app.config.ts',
    'app.config.js',
    'app.config.mjs',
    'app.scss',
    'app.less',
    'app.css',
])

export const copied = new Set<string>()
const entryVisited = new Set<string>()

/* ============================================================
 * 脚本引用提取
 * ============================================================ */

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

        if (node.type === 'ImportExpression' && node.source?.type === 'StringLiteral') {
            specs.add(node.source.value)
            return
        }

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

/* ============================================================
 * 样式引用提取
 * ============================================================ */

export const extractStyleSpecifiers = (code: string): string[] => {
    const specs = new Set<string>()

    const cleaned = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

    const atRule = /@(?:import|use|forward)\s+(?:url\(\s*)?(?:['"]([^'"]+)['"]|([^'";)\s]+))/g
    let m: RegExpExecArray | null
    while ((m = atRule.exec(cleaned))) {
        const spec = m[1] || m[2]
        if (!spec) continue
        if (/^(?:https?:)?\/\//.test(spec) || spec.startsWith('data:')) continue
        specs.add(spec)
    }

    const urlRe = /url\(\s*['"]?([^'")]+)['"]?\s*\)/g
    while ((m = urlRe.exec(cleaned))) {
        const v = m[1].trim()
        if (/^(?:https?:)?\/\//.test(v) || v.startsWith('data:') || v.startsWith('#')) continue
        specs.add(v)
    }

    return [...specs]
}

/* ============================================================
 * 路径解析
 * ============================================================ */

export const resolveSpecifier = (
    spec: string,
    fromFile: string,
    alias: Record<string, string[]>,
    extensions: string[]
): string | null => {
    if (spec.startsWith('.')) {
        const base = path.resolve(path.dirname(fromFile), spec)
        return tryResolve(base, extensions)
    }

    const aliasKeys = Object.keys(alias).sort((a, b) => b.length - a.length)
    for (const key of aliasKeys) {
        const clean = key.replace(/\/\*$/, '').replace(/\/$/, '')
        if (!clean) continue

        if (spec === clean || spec.startsWith(clean + '/')) {
            const rest = spec === clean ? '' : spec.slice(clean.length + 1)
            for (const target of alias[key]) {
                const targetClean = target.replace(/\/\*$/, '').replace(/\/$/, '')
                const found = tryResolve(path.resolve(targetClean, rest), extensions)
                if (found) return found
            }
        }
    }

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

/* ============================================================
 * 核心
 * ============================================================ */

interface CopyContext {
    /** 输出根目录（绝对路径） */
    outputRoot: string
    excludeFiles: string[]
    maxDepth: number
    depth: number
    dirMode: DirMode
    verbose: boolean
}

const copyEntry = (src: string, ctx: CopyContext) => {
    const abs = path.resolve(src)

    // 绝对路径拦截：防止自包含
    const outputAbs = path.resolve(ctx.outputRoot)
    if (
        abs === outputAbs ||
        abs.startsWith(outputAbs + path.sep) ||
        abs === GENERATED_ROOT ||
        abs.startsWith(GENERATED_ROOT + path.sep)
    )
        return

    if (copied.has(abs)) return
    copied.add(abs)

    if (!fs.existsSync(abs)) {
        console.warn(`[skip] 源路径不存在: ${abs}`)
        return
    }

    const stat = fs.lstatSync(abs)

    if (stat.isSymbolicLink()) {
        console.warn(`[skip] 符号链接: ${abs}`)
        return
    }

    // ---------- 目录 ----------
    if (stat.isDirectory()) {
        for (const item of fs.readdirSync(abs)) {
            if (SKIP_DIRS.has(item) || SKIP_FILES.has(item)) continue
            if (ctx.excludeFiles.some((ex) => item === ex || item.includes(ex))) continue

            const childAbs = path.join(abs, item)

            if (ctx.dirMode === 'entry') {
                resolveEntryDeps(childAbs, ctx)
            } else {
                copyEntry(childAbs, ctx)
            }
        }
        return
    }

    if (!stat.isFile()) return

    // ---------- 文件：先解析依赖，再复制 ----------
    const ext = path.extname(abs).toLowerCase()
    const canGoDeeper = ctx.maxDepth < 0 || ctx.depth < ctx.maxDepth

    if (canGoDeeper && (SCRIPT_EXTENSIONS.has(ext) || STYLE_EXTENSIONS.has(ext))) {
        const code = fs.readFileSync(abs, 'utf8')
        const specs = SCRIPT_EXTENSIONS.has(ext)
            ? extractScriptSpecifiers(code)
            : extractStyleSpecifiers(code)

        for (const spec of specs) {
            const resolved = resolveSpecifier(spec, abs, ALIAS, DEFAULT_EXTENSIONS)
            if (!resolved) continue

            if (ctx.verbose) {
                console.log(
                    `[dep:d${ctx.depth}] ${path.relative(rootPath, abs)} → ${spec} → ${path.relative(rootPath, resolved)}`
                )
            }

            copyEntry(resolved, { ...ctx, depth: ctx.depth + 1 })
        }
    }

    const dest = computeDest(abs, ctx)
    if (!dest) {
        console.warn(`[skip] 输出路径非法: ${abs}`)
        return
    }

    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(abs, dest)
    console.log(
        `[copy:d${ctx.depth}] ${path.relative(rootPath, abs)} → ${path.relative(rootPath, dest)}`
    )
}

const resolveEntryDeps = (abs: string, ctx: CopyContext) => {
    if (entryVisited.has(abs)) return
    entryVisited.add(abs)

    if (!fs.existsSync(abs)) return
    const stat = fs.lstatSync(abs)

    if (stat.isSymbolicLink()) return

    if (stat.isDirectory()) {
        for (const item of fs.readdirSync(abs)) {
            if (SKIP_DIRS.has(item) || SKIP_FILES.has(item)) continue
            if (ctx.excludeFiles.some((ex) => item === ex || item.includes(ex))) continue
            resolveEntryDeps(path.join(abs, item), ctx)
        }
        return
    }

    if (!stat.isFile()) return
    if (!isEntryFile(abs)) return

    copyEntry(abs, ctx)
}

const isEntryFile = (abs: string): boolean => {
    const rel = path.relative(rootPath, abs).split(path.sep).join('/')
    if (/(^|\/)pages\//.test(rel)) return true
    return ENTRY_FILENAMES.has(path.basename(abs))
}

/**
 * 目标路径 = outputRoot + 源文件相对项目根的路径
 *
 * 这是唯一权威的映射规则，不再依赖 inputBase 反推，
 * 从根本上杜绝 generated 嵌套。
 */
const computeDest = (abs: string, ctx: CopyContext): string | null => {
    // 相对项目根计算
    let rel = path.relative(rootPath, abs)
    rel = rel.split(path.sep).join('/')

    // 源头在项目外 / 指向 generated 本身 → 拒绝
    if (
        rel.startsWith('..') ||
        path.isAbsolute(rel) ||
        rel === GENERATED_DIR ||
        rel.startsWith(GENERATED_DIR + '/')
    ) {
        return null
    }

    const outputAbs = path.resolve(ctx.outputRoot)
    const destAbs = path.resolve(path.join(outputAbs, rel))

    // 保险 1：dest 必须在 outputRoot 之下
    if (destAbs !== outputAbs && !destAbs.startsWith(outputAbs + path.sep)) {
        return null
    }

    // 保险 2：dest 路径里不能出现两次 generated
    const segments = destAbs.split(path.sep).filter(Boolean)
    if (segments.filter((s) => s === GENERATED_DIR).length > 1) {
        console.warn(`[FATAL] 检测到 generated 嵌套，已拒绝: ${destAbs}`)
        console.warn(`  source: ${abs}`)
        console.warn(`  outputRoot: ${ctx.outputRoot}`)
        console.warn(`  rel: ${rel}`)
        return null
    }

    return destAbs
}

/* ============================================================
 * 对外 API
 * ============================================================ */

export const generateEngineer = (config: GenerateEngineerConfig) => {
    const { inputDir, outputRoot, excludeFiles = [], maxDepth = -1, dirMode = 'copy' } = config

    if (!fs.existsSync(inputDir)) {
        console.warn(`[skip] 输入路径不存在: ${inputDir}`)
        return
    }

    copyEntry(inputDir, {
        outputRoot,
        excludeFiles,
        maxDepth,
        depth: 0,
        dirMode,
        verbose: true,
    })
}

export const createProject = (options: ProjectOptions) => {
    const outputRootPath = path.join(rootPath, GENERATED_DIR, options.projectName)
    const excludeFiles = options.excludeFiles ?? []
    const clean = options.clean !== false
    const defaultMaxDepth = options.maxDepth ?? -1
    const defaultDirMode = options.dirMode ?? 'copy'

    // 清空整个 generated 目录，彻底消除历史残留
    if (clean && fs.existsSync(GENERATED_ROOT)) {
        fs.rmSync(GENERATED_ROOT, { recursive: true, force: true })
    }

    copied.clear()
    entryVisited.clear()

    // ---------- copyFiles 为空：遍历根目录顶层项 ----------
    if (!options.copyFiles.length) {
        for (const item of fs.readdirSync(rootPath)) {
            if (SKIP_DIRS.has(item) || SKIP_FILES.has(item)) continue
            if (excludeFiles.some((ex) => item === ex || item.includes(ex))) continue

            const itemAbs = path.join(rootPath, item)
            const itemStat = fs.statSync(itemAbs)
            const dirMode: DirMode = item === 'src' ? 'entry' : defaultDirMode

            generateEngineer({
                inputDir: itemAbs,
                outputRoot: outputRootPath, // ⬅️ 统一用项目输出根
                excludeFiles,
                maxDepth: defaultMaxDepth,
                dirMode: itemStat.isFile() ? 'copy' : dirMode,
            })
        }

        createPage({
            templates: schemas.pagesConfig.templates as any[],
            projectName: options.projectName,
        })
        return
    }

    // ---------- copyFiles 有值：逐个处理 ----------
    options.copyFiles.forEach((item) => {
        const isString = typeof item === 'string'
        const inputDir = isString ? item : item.inputDir
        const itemMaxDepth = isString ? defaultMaxDepth : (item.maxDepth ?? defaultMaxDepth)
        const itemDirMode = isString ? defaultDirMode : (item.dirMode ?? defaultDirMode)

        generateEngineer({
            inputDir: path.join(rootPath, inputDir),
            outputRoot: outputRootPath, // ⬅️ 统一用项目输出根
            excludeFiles,
            maxDepth: itemMaxDepth,
            dirMode: itemDirMode,
        })

        createPage({
            templates: schemas.pagesConfig.templates as any[],
            projectName: options.projectName,
        })
    })
}

/* ============================================================
 * 辅助：单独收集依赖
 * ============================================================ */

export const dependenciesCollect = (fromFile: string, callback?: (resolved: string) => void) => {
    const abs = path.resolve(fromFile)
    const ext = path.extname(abs).toLowerCase()

    if (!SCRIPT_EXTENSIONS.has(ext) && !STYLE_EXTENSIONS.has(ext)) return

    const code = fs.readFileSync(abs, 'utf8')
    const specs = SCRIPT_EXTENSIONS.has(ext)
        ? extractScriptSpecifiers(code)
        : extractStyleSpecifiers(code)

    for (const spec of specs) {
        const resolved = resolveSpecifier(spec, abs, ALIAS, DEFAULT_EXTENSIONS)
        if (resolved) callback?.(resolved)
    }
}
