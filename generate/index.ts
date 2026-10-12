import path from 'node:path'
import fs from 'node:fs'
import { execSync } from 'node:child_process'

import schemas from '../schemas/pages.json'

interface Templates {
    content: string
    path: string
    type?: 'page' | 'component' | 'config' | 'style'
}

interface CreateOptions {
    templates: Templates[]
}

const createDir = (relativePath: string) => {
    const dir = path.join(process.cwd(), relativePath)

    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(dir, { recursive: true })
}

const createAppConfig = () => {
    const appConfigDir = path.join(process.cwd(), 'src/app.config.ts')
    const context = (content: string) => `export default defineAppConfig(${content})
`
    fs.writeFileSync(appConfigDir, context(JSON.stringify(schemas.appConfig)))
}

const upsert = async (filePath: string, key: string, value: string) => {
    let readContent = await fs.promises.readFile(filePath, 'utf8')
    const re = new RegExp(`^([ \\t]*${key}\\s*=\\s*).*$`, 'm')

    if (re.test(readContent)) {
        readContent = readContent.replace(re, `$1${value}`)
    } else {
        readContent = readContent.trimEnd() + `\n${key}='${value}'\n`
    }

    await fs.promises.writeFile(filePath, readContent, 'utf8')
}

const setAppId = (id: string) => {
    upsert('./.env.development', 'TARO_APP_ID', id)
    upsert('./.env.production', 'TARO_APP_ID', id)
    upsert('./.env.test', 'TARO_APP_ID', id)
}

const createPage = (options: CreateOptions, callback?: () => void) => {
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

const create = () => {
    setAppId(schemas.appId)
    createAppConfig()
    createPage(
        {
            templates: schemas.templates as any,
        },
        () => {
            execSync('npm run build:weapp', {
                stdio: 'inherit',
                cwd: process.cwd(),
            })
        }
    )
}
create()
