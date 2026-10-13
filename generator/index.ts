import { Generator } from './core'
import type { PageOptions } from './core'
import schemas from '../schemas/pages.json'

import { wxAppUpload } from './config/wx'

const generatorInstance = new Generator({
    id: schemas.id,
    version: schemas.version,
    appid: schemas.appid,
    appConfig: schemas.appConfig,
    templates: schemas.templates as PageOptions['templates'],
})

generatorInstance.generate((res) => {
    if (res.status) {
        wxAppUpload({
            errorCallback() {
                console.log('wxAppUpload error')
            },
        })
    } else {
        console.log('打包失败')
    }
})
