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
    appId: string
    appConfig: Record<string, unknown>
}

export class Generator {
    private appId: string = ''
    private templates: Templates[] = []
    private appConfig: Options['appConfig'] = {}

    constructor(options: Options) {
        this.appId = options.appId
        this.templates = options.templates
        this.appConfig = options.appConfig
    }

    setAppId() {
        upsert('./.env.development', 'TARO_APP_ID', this.appId)
        upsert('./.env.production', 'TARO_APP_ID', this.appId)
        upsert('./.env.test', 'TARO_APP_ID', this.appId)
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

    generate() {
        this.setAppId()
        this.createAppConfig()
        this.createPage(
            {
                templates: this.templates,
            },
            () => {
                execSync('npm run build:weapp', {
                    stdio: 'inherit',
                    cwd: process.cwd(),
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
