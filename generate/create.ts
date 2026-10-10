import path from 'node:path'
import fs from 'node:fs'

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
    const outputDir = path.join(process.cwd(), 'generated', options.projectName, 'src')

    fs.mkdirSync(outputDir, { recursive: true })

    for (const template of options.templates) {
        const templatePath = path.join(outputDir, template.path)

        fs.mkdirSync(path.dirname(templatePath), { recursive: true })
        fs.writeFileSync(templatePath, template.content)
    }

    callback?.()
}
