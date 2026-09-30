import fs from 'node:fs'
import path from 'node:path'
import { parse } from '@babel/parser'

/* ============================================================
 * 类型
 * ============================================================ */

interface GenerateEngineerConfig {
    inputDir: string
    /** 不传时默认按 inputDir 相对项目根镜像输出 */
    outputDir?: string
    /** 额外的路径别名（会与 tsconfig 的 paths 合并） */
    alias?: Record<string, string[]>
    /** 需要尝试补全的后缀，默认 DEFAULT_EXTENSIONS */
    extensions?: string[]
}

interface ProjectOptions {
    projectName: string
    copyFiles: (string | GenerateEngineerConfig)[]
}

/* ============================================================
 * 常量
 * ============================================================ */

const rootPath = process.cwd()
const GENERATED_DIR = 'generated'

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

/* ============================================================
 * 对外 API
 * ============================================================ */

export const createProject = (options: ProjectOptions) => {
    const outputRootPath = path.join(rootPath, GENERATED_DIR, options.projectName)
    const tsAlias = loadTsconfigAliases(path.join(rootPath, 'tsconfig.json'))

    options.copyFiles?.forEach((item) => {
        const isString = typeof item === 'string'

        const inputDir = isString ? item : item.inputDir
        const outputDir = isString ? undefined : item.outputDir
        const alias = { ...tsAlias, ...(isString ? {} : (item.alias ?? {})) }
        const extensions = (isString ? undefined : item.extensions) ?? DEFAULT_EXTENSIONS

        const inputAbs = path.resolve(rootPath, inputDir)

        if (!fs.existsSync(inputAbs)) {
            console.warn(`[skip] 输入路径不存在: ${inputAbs}`)
            return
        }

        // 1. 收集：入口 + 所有递归引用到的文件
        const files = collectFiles({
            entries: [inputAbs],
            alias,
            extensions,
        })

        const inputIsDir = fs.statSync(inputAbs).isDirectory()
        const inputBase = inputIsDir ? inputAbs : path.dirname(inputAbs)

        // 2. 复制：保持目录结构
        for (const file of files) {
            let rel: string

            if (outputDir) {
                // 显式指定输出目录：入口内的文件镜像到 outputDir，
                // 别名引到外部的文件回落到项目根镜像
                const relToInput = path.relative(inputBase, file)
                rel = relToInput.startsWith('..')
                    ? path.relative(rootPath, file)
                    : path.join(outputDir, relToInput)
            } else {
                // 默认：相对项目根目录镜像（保证 src/、types/ 等结构一致）
                rel = path.relative(rootPath, file)
            }

            if (
                rel.startsWith('..') ||
                path.isAbsolute(rel) ||
                rel === GENERATED_DIR ||
                rel.startsWith(GENERATED_DIR + path.sep)
            ) {
                console.warn(`[skip] 输出路径非法: ${file}`)
                continue
            }

            const dest = path.join(outputRootPath, rel)
            fs.mkdirSync(path.dirname(dest), { recursive: true })
            fs.copyFileSync(file, dest)
            console.log(`[copy] ${path.relative(rootPath, file)}`)
        }
    })
}

/* ============================================================
 * 收集依赖
 * ============================================================ */

interface CollectOptions {
    entries: string[]
    alias: Record<string, string[]>
    extensions: string[]
}

const collectFiles = (opts: CollectOptions): string[] => {
    const { entries, alias, extensions } = opts
    const visited = new Set<string>()
    const result: string[] = []

    const visit = (file: string) => {
        const abs = path.resolve(file)
        if (visited.has(abs)) return
        visited.add(abs)

        if (!fs.existsSync(abs)) {
            console.warn(`[skip] 引用文件不存在: ${abs}`)
            return
        }

        const stat = fs.statSync(abs)

        if (stat.isDirectory()) {
            for (const child of walkDir(abs)) visit(child)
            return
        }

        if (abs.includes(`${path.sep}node_modules${path.sep}`)) return

        result.push(abs)

        const ext = path.extname(abs).toLowerCase()
        if (!SCRIPT_EXTENSIONS.has(ext)) return

        let code = fs.readFileSync(abs, 'utf8')
        if (ext === '.vue') code = extractVueScript(code)

        for (const spec of extractSpecifiers(code)) {
            const resolved = resolveSpecifier(spec, abs, alias, extensions)
            if (resolved) visit(resolved)
        }
    }

    entries.forEach(visit)
    return [...new Set(result)]
}

/* ============================================================
 * 从源码提取所有引用
 * ============================================================ */

const extractSpecifiers = (code: string): string[] => {
    const specs = new Set<string>()

    let ast: any
    try {
        ast = parse(code, {
            sourceType: 'unambiguous',
            plugins: PARSER_PLUGINS,
            errorRecovery: true,
        })
    } catch {
        return []
    }

    walkAst(ast, (node) => {
        // import x from '...' / export * from '...' / export { x } from '...'
        if (
            (node.type === 'ImportDeclaration' ||
                node.type === 'ExportNamedDeclaration' ||
                node.type === 'ExportAllDeclaration') &&
            node.source?.type === 'StringLiteral'
        ) {
            specs.add(node.source.value)
            return
        }

        // require('...')
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
        }
    })

    return [...specs]
}

/* ============================================================
 * 路径解析
 * ============================================================ */

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
    for (const [key, targets] of Object.entries(alias)) {
        const clean = key.replace(/\/\*$/, '')
        if (spec === clean || spec.startsWith(clean + '/')) {
            const rest = spec === clean ? '' : spec.slice(clean.length + 1)
            for (const target of targets) {
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

/* ============================================================
 * tsconfig paths → 绝对路径别名
 * ============================================================ */

const loadTsconfigAliases = (tsconfigPath: string): Record<string, string[]> => {
    if (!fs.existsSync(tsconfigPath)) return {}

    try {
        const raw = stripJsonComments(fs.readFileSync(tsconfigPath, 'utf8'))
        const json = JSON.parse(raw)
        const co = json.compilerOptions ?? {}
        const baseDir = path.resolve(path.dirname(tsconfigPath), co.baseUrl ?? '.')
        const paths = co.paths ?? {}

        const result: Record<string, string[]> = {}
        for (const [key, value] of Object.entries(paths)) {
            const list = Array.isArray(value) ? value : [value]
            result[key] = list.map((p) => path.resolve(baseDir, String(p)))
        }
        return result
    } catch (e) {
        console.warn('[warn] tsconfig 解析失败:', e)
        return {}
    }
}

const stripJsonComments = (str: string) =>
    str
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1')
        .replace(/,\s*([}\]])/g, '$1')

/* ============================================================
 * 工具
 * ============================================================ */

const extractVueScript = (code: string): string => {
    const m = code.match(/<script[^>]*>([\s\S]*?)<\/script>/i)
    return m ? m[1] : ''
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

function* walkDir(dir: string): Generator<string> {
    for (const name of fs.readdirSync(dir)) {
        if (name === 'node_modules' || name === '.git') continue
        const full = path.join(dir, name)
        const stat = fs.statSync(full)
        if (stat.isDirectory()) yield* walkDir(full)
        else yield full
    }
}

const isFile = (p: string) => {
    try {
        return fs.statSync(p).isFile()
    } catch {
        return false
    }
}
