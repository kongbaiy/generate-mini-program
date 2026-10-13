import path from 'node:path'
import fs from 'node:fs'
import { execSync } from 'node:child_process'

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
