import path from 'node:path'
import fs from 'node:fs'
import { dependenciesCollect } from './engineer'

interface Templates {
    content: string
    path: string
    type?: 'page' | 'component' | 'config' | 'style'
}

interface CreateOptions {
    projectName: string
    templates: Templates[]
}

export const createPage = (options: CreateOptions, callback?: () => void) => {
    const outputDir = `generated/${options.projectName}/src`
    const generatedDir = path.resolve(outputDir)
    const existsDir = fs.existsSync(generatedDir)

    if (!existsDir) fs.mkdirSync(generatedDir, { recursive: true })

    for (const template of options.templates) {
        const templatePath = path.join(generatedDir, template.path)

        fs.mkdirSync(path.dirname(templatePath), { recursive: true })
        fs.writeFileSync(templatePath, template.content)
        dependenciesCollect(options.projectName, templatePath, (resolved) => {
            const output = resolved.replace('src', outputDir)

            fs.mkdirSync(path.dirname(output), { recursive: true })
            fs.copyFileSync(resolved, output)
        })
    }

    callback?.()
}
