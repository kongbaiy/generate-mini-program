import fs from 'node:fs'
import path from 'node:path'

interface GenerateEngineerConfig {
    inputDir: string
    outputDir: string
}

interface ProjectOptions {
    projectName: string
    copyFiles: (GenerateEngineerConfig | string)[]
}

const rootPath = process.cwd()

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

export const generateEngineer = (config: GenerateEngineerConfig) => {
    copyRecursive(config.inputDir, config.outputDir)
}

const copyRecursive = (src: string, dest: string) => {
    if (!fs.existsSync(src)) {
        console.warn(`[skip] 源路径不存在: ${src}`)
        return
    }

    const stat = fs.statSync(src)

    if (stat.isDirectory()) {
        fs.mkdirSync(dest, { recursive: true })

        for (const item of fs.readdirSync(src)) {
            copyRecursive(path.join(src, item), path.join(dest, item))
        }
    } else {
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        fs.copyFileSync(src, dest)
    }
}
