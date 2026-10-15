import path from 'node:path'
import fs from 'node:fs'
import ci from 'miniprogram-ci'
import { MiniProgramCI } from 'miniprogram-ci/dist/@types/types'

import schemas from '../../../schemas/pages.json'

interface Upload {
    onProgress?: (task: string | MiniProgramCI.ITaskStatus) => void
    successCallback?: (result: unknown) => void
    errorCallback?: (message: unknown) => void
}

const project = new ci.Project({
    appid: schemas.appid,
    type: 'miniProgram',
    projectPath: path.join(process.cwd(), 'dist'),
    privateKeyPath: './config/wx/private.key',
})

export async function wxAppUpload(options: Upload = {}) {
    const privateKeyPath = path.join(process.cwd(), 'config/wx/private.key')

    if (!fs.existsSync(privateKeyPath)) {
        const error = new Error(`密钥文件不存在: ${privateKeyPath}`)

        options.errorCallback?.(error)
        return
    }

    try {
        const result = await ci.upload({
            project,
            version: schemas.version,
            desc: 'CI 构建',
            onProgressUpdate: options.onProgress,
        })

        options.successCallback?.(result)
    } catch (error) {
        options.errorCallback?.(error)
    }
}
