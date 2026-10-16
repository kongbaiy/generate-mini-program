import { defineConfig, type UserConfigExport } from '@tarojs/cli'
import path from 'path'

import devConfig from './dev'
import prodConfig from './prod'

import schemas from '../schemas/pages.json'

// Taro v4 的 CLI 已不再支持 `--ui`/`TARO_BUILD_TYPE=ui`,
// 这里用 Vite 的 library 模式自行实现「只打包 src/components」的 UI 库构建。
const isBuildUI = process.env.TARO_BUILD_TYPE === 'ui'

const uiLibEntry = path.resolve(__dirname, '../src/components/index.ts')

/** 把 H5 构建改写成 Vite library 模式:入口指向 src/components,产物不带页面与 html */
const uiLibPlugin = {
    name: 'taro:ui-lib',
    // enforce: 'post' 保证本插件的 config 覆盖 Taro 内置 h5 构建配置
    enforce: 'post' as const,
    config() {
        return {
            build: {
                outDir: path.resolve(__dirname, '../dist-ui'),
                emptyOutDir: true,
                lib: {
                    entry: uiLibEntry,
                    name: 'MpUI',
                    formats: ['es', 'umd'] as ('es' | 'umd')[],
                },
                rollupOptions: {
                    // UMD 要能被 script 标签直引,必须自包含:
                    // react/jsx-runtime 和 @tarojs/* 都没有官方 UMD 全局可用,只能内联进产物。
                    // 只保留 react/react-dom 走全局(官方 UMD 提供 React / ReactDOM)
                    external: ['react', 'react-dom'],
                    output: {
                        globals: {
                            react: 'React',
                            'react-dom': 'ReactDOM',
                        },
                    },
                },
            },
        }
    },
    // Taro 内置配置写死了 output.entryFileNames,会覆盖 lib 自动生成的文件名,
    // 这里按产物格式把入口文件名改回来,同时清掉内置的 manualChunks
    // (umd 会开启 inlineDynamicImports,与 manualChunks 互斥)
    outputOptions(options: { format?: string; entryFileNames?: unknown; manualChunks?: unknown }) {
        options.manualChunks = undefined
        if (options.format === 'es') options.entryFileNames = 'index.es.js'
        else if (options.format === 'umd') options.entryFileNames = 'index.umd.js'
    },
}

export default defineConfig<'vite'>(async (merge) => {
    const baseConfig: UserConfigExport<'vite'> = {
        projectName: schemas?.projectName,
        date: new Date().toLocaleDateString().replace(/\//g, '-'),
        designWidth: 750,
        deviceRatio: {
            640: 2.34 / 2,
            750: 1,
            375: 2,
            828: 1.81 / 2,
        },
        sourceRoot: 'src',
        outputRoot: isBuildUI ? 'dist-ui' : 'dist',
        plugins: ['@tarojs/plugin-generator'],
        defineConstants: {},
        copy: {
            patterns: [],
            options: {},
        },
        framework: 'react',
        compiler: isBuildUI ? { type: 'vite', vitePlugins: [uiLibPlugin] } : 'vite',
        alias: {
            '@': path.resolve(__dirname, '../src'),
        },
        mini: {
            postcss: {
                pxtransform: {
                    enable: true,
                    config: {},
                },
                cssModules: {
                    enable: true, // 默认为 false，如需使用 css modules 功能，则设为 true
                    config: {
                        namingPattern: 'module', // 转换模式，取值为 global/module
                        generateScopedName: '[name]__[local]___[hash:base64:5]',
                    },
                },
            },
        },
        h5: {
            publicPath: './',
            staticDirectory: 'static',

            miniCssExtractPluginOption: {
                ignoreOrder: true,
                filename: 'css/[name].[hash].css',
                chunkFilename: 'css/[name].[chunkhash].css',
            },

            postcss: {
                autoprefixer: {
                    enable: true,
                    config: {},
                },
                cssModules: {
                    enable: true, // 默认为 false，如需使用 css modules 功能，则设为 true
                    config: {
                        namingPattern: 'module', // 转换模式，取值为 global/module
                        generateScopedName: '[name]__[local]___[hash:base64:5]',
                    },
                },
            },
        },
        rn: {
            appName: 'taroDemo',
            postcss: {
                cssModules: {
                    enable: false, // 默认为 false，如需使用 css modules 功能，则设为 true
                },
            },
        },
    }

    process.env.BROWSERSLIST_ENV = process.env.NODE_ENV

    if (process.env.NODE_ENV === 'development') {
        // 本地开发构建配置（不混淆压缩）
        return merge({}, baseConfig, devConfig)
    }

    // 生产构建配置（默认开启压缩混淆等）
    const config: UserConfigExport<'vite'> = merge({}, baseConfig, prodConfig)

    if (isBuildUI) {
        // @vitejs/plugin-legacy 不支持 library 模式,UI 库构建需关掉
        // （prod.ts 里的 h5.legacy 是给应用构建用的 es5 兜底）
        if (config.h5) config.h5.legacy = false
    }

    return config
})
