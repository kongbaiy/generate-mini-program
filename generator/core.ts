import path from 'node:path'
import fs from 'node:fs'
import { execSync } from 'node:child_process'
import https from 'node:https'
import http from 'node:http'

interface Templates {
    content: string
    path: string
    type: 'page' | 'component' | 'config' | 'style'
}

export interface PageOptions {
    templates: Templates[]
}

export interface Options extends PageOptions {
    id: string
    version: string
    appid: string
    appConfig: Record<string, unknown>
}

interface BuildOptions {
    successCallback?: () => void
    errorCallback?: (message: unknown) => void
}

interface GenerateCallbackOptions {
    status: boolean
    message?: unknown
}

interface NodeServerSend {
    url: string
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
    headers?: Record<string, string>
    body?: unknown
    timeout?: number
    onSuccess?: (res: {
        statusCode: number
        headers: http.IncomingHttpHeaders
        data: string
    }) => void
    onError?: (err: Error) => void
}

type NodeServerMethodOtherOptions =
    Parameters<NodeServer['sendPromise']> extends [unknown, ...infer Rest] ? Rest : never

export class Generator {
    private appid: string = ''
    private templates: Templates[] = []
    private appConfig: Options['appConfig'] = {}

    constructor(options: Options) {
        this.appid = options.appid
        this.templates = options.templates
        this.appConfig = options.appConfig
    }

    setAppId() {
        upsert('./.env.development', 'TARO_APP_ID', this.appid)
        upsert('./.env.production', 'TARO_APP_ID', this.appid)
        upsert('./.env.test', 'TARO_APP_ID', this.appid)
    }

    createAppConfig() {
        const appConfigDir = path.join(process.cwd(), 'src/app.config.ts')
        const context = (content: string) => `export default defineAppConfig(${content})
`
        fs.writeFileSync(appConfigDir, context(JSON.stringify(this.appConfig)))
    }

    createPage(options: PageOptions, callback?: () => void) {
        const outputDir = path.join(process.cwd(), 'src')

        fs.rmSync(outputDir + '/pages', { recursive: true, force: true })
        fs.mkdirSync(outputDir, { recursive: true })

        for (const template of options.templates) {
            const templatePath = path.join(outputDir, template.path)

            fs.mkdirSync(path.dirname(templatePath), { recursive: true })
            fs.writeFileSync(templatePath, template.content)
        }

        callback?.()
    }

    build(options: BuildOptions = {}) {
        try {
            execSync('npm run build:weapp', {
                stdio: ['inherit', 'pipe', 'pipe'],
                encoding: 'utf-8',
                cwd: process.cwd(),
            })

            options.successCallback?.()
        } catch (error) {
            const execError = error as Error & {
                stdout?: string | Buffer
                stderr?: string | Buffer
            }

            if (execError.stdout) {
                process.stdout.write(
                    typeof execError.stdout === 'string'
                        ? execError.stdout
                        : execError.stdout.toString()
                )
            }

            if (execError.stderr) {
                process.stderr.write(
                    typeof execError.stderr === 'string'
                        ? execError.stderr
                        : execError.stderr.toString()
                )
            }

            console.error('❌ 构建失败')
            options.errorCallback?.(execError)
            process.exit(1)
        }
    }

    generate(callback?: (options: GenerateCallbackOptions) => void) {
        this.setAppId()
        this.createAppConfig()
        this.createPage(
            {
                templates: this.templates,
            },
            () => {
                this.build({
                    successCallback() {
                        callback?.({
                            status: true,
                        })
                    },
                    errorCallback(message) {
                        callback?.({
                            status: false,
                            message,
                        })
                    },
                })
            }
        )
    }
}

async function upsert(filePath: string, key: string, value: string) {
    const re = new RegExp(`^([ \\t]*${key}\\s*=\\s*).*$`, 'm')
    let readContent = await fs.promises.readFile(filePath, 'utf8')

    if (re.test(readContent)) readContent = readContent.replace(re, `$1${value}`)
    else readContent = readContent.trimEnd() + `\n${key}='${value}'\n`

    await fs.promises.writeFile(filePath, readContent, 'utf8')
}

export class NodeServer {
    constructor() {}

    send(options: NodeServerSend) {
        const {
            url,
            method = 'POST',
            headers = {},
            body,
            timeout = 5000,
            onSuccess,
            onError,
        } = options

        let verifiedUrl: URL

        try {
            verifiedUrl = new URL(url)
        } catch (err) {
            onError?.(new Error(`Invalid URL: ${url}`))
            return
        }

        const client = verifiedUrl.protocol === 'https:' ? https : http
        const newHeaders = {
            'Content-Type': 'application/json',
            ...headers,
        }
        const bodyString = body !== undefined ? JSON.stringify(body) : ''

        if (bodyString) newHeaders['Content-Length'] = String(Buffer.byteLength(bodyString))

        const req = client.request(
            {
                method,
                hostname: verifiedUrl.hostname,
                port: verifiedUrl.port || (verifiedUrl.protocol === 'https:' ? 443 : 80),
                path: verifiedUrl.pathname + verifiedUrl.search,
                headers: newHeaders,
                timeout,
            },
            (res) => {
                let data = ''
                res.setEncoding('utf8')
                res.on('data', (chunk) => (data += chunk))
                res.on('end', () => {
                    onSuccess?.({
                        statusCode: res.statusCode ?? 0,
                        headers: res.headers,
                        data,
                    })
                })
            }
        )

        req.on('error', (err) => {
            onError?.(err)
        })
        req.on('timeout', () => {
            req.destroy(new Error(`Request timeout after ${timeout}ms`))
        })

        if (bodyString) req.write(bodyString)

        req.end()
    }

    sendPromise(
        method: NodeServerSend['method'],
        url: string,
        body?: NodeServerSend['body'],
        otherOptions?: Omit<NodeServerSend, 'method' | 'url' | 'body'>
    ) {
        return new Promise((resolve, reject) => {
            this.send({
                method,
                url,
                body,
                ...otherOptions,
                onSuccess: (res) => {
                    resolve(res.data)
                },
                onError: (err) => {
                    reject(err)
                },
            })
        })
    }

    post(...args: NodeServerMethodOtherOptions) {
        return this.sendPromise('POST', ...args)
    }

    get(...args: NodeServerMethodOtherOptions) {
        return this.sendPromise('GET', ...args)
    }

    put(...args: NodeServerMethodOtherOptions) {
        return this.sendPromise('PUT', ...args)
    }

    delete(...args: NodeServerMethodOtherOptions) {
        return this.sendPromise('DELETE', ...args)
    }
}
