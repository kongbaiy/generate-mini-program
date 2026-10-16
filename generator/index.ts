import { Generator, NodeServer } from './core'
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

const ns = new NodeServer()

generatorInstance.generate((res) => {
    if (res.status) {
        // wxAppUpload({
        //     errorCallback() {
        //         console.log('wxAppUpload error')
        //     },
        // })

        ns.send({
            method: 'POST',
            url: 'https://enterprise-test-v3.szyplus.com/api/auth/login',
            body: {
                loginAccount: 'admin@001',
                loginPassword:
                    'dE0ziFrAlPf+BACPDdrfJTx4hOyoztpSECu34WFaGQ/B8lTRws3mqY6PxWhMmVHfdsAtnNrZpjmlm40dTboans98tBUo6GK8RxWwu29vrMlKEDhx21BiZoFC/27qSzWXKQtgZNjlpQJ3o3cR3Ktf6otHW01HIcvcCBdmXhrB7JKWBuMHkQZac/Bs3LgWsPcJkkcVdUGsgNjKW2ZU34/TIRio2qJfzj7UwmGsBzQq9vQQ3uofybgEmgn97gv2/tFPcvogmhNI0Kan4Bn75dIp2BSa4B7QTrzW8OiRU2ffWmafDl91qvhhe+9fPapJh5NEzPobS6Ku2eSdGCh0uHNUbg==',
                captchaCode: 'TTJG',
                platformCode: 'ENTERPRISE_PC',
                captchaKey: '6eCISqN4snuNz0NSjFAtEQ',
            },
            onSuccess: (res) => {
                console.log('res: ', res)
            },
            onError: (err) => {
                console.log('err: ', err)
            },
        })
    } else {
        console.log('打包失败')
    }
})
