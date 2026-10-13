import { Generator } from './core'
import type { PageOptions } from './core'
import schemas from '../schemas/pages.json'

const generatorInstance = new Generator({
    id: schemas.id,
    version: schemas.version,
    appid: schemas.appid,
    appConfig: schemas.appConfig,
    templates: schemas.templates as PageOptions['templates'],
})

generatorInstance.generate()
