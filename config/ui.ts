import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

const root = path.resolve(__dirname.replace('/config', ''))

// 两段式构建(npm run build:ui 会依次执行):
// --mode lib-es  : ES 产物。react/jsx-runtime 外置,由宿主项目提供匹配版本 → React 18/19 通用。
//                  (React 19 移除了 __SECRET_INTERNALS_*,内联 React 18 的 jsx-runtime 在 19 上会崩)
// --mode lib-umd : UMD 产物。自包含 jsx-runtime,供 script 标签直引。
//                  (React 19 完全没有 UMD 构建,script 直引场景只有 React 18)
export default defineConfig(({ mode }) => {
    const isUmd = mode === 'lib-umd'
    return {
        root,
        plugins: [react()],
        define: {
            'process.env.TARO_ENV': '"h5"',
            'process.env.NODE_ENV': '"production"',
            // Stencil react-output-target 的构建期开关:false = 立即注册 custom elements
            DEPRECATED_ADAPTER_COMPONENT: 'false',
        },
        resolve: {
            alias: [
                // 包默认入口 dist/index.js 导出的是 Stencil 原生控制器类(非 React 组件),
                // 直接喂给 React 会报 "Class constructor cannot be invoked without 'new'"。
                // 必须使用官方 React 适配层:customElements + reactify-wc 包装。
                {
                    find: /^@tarojs\/components$/,
                    replacement: path.join(
                        root,
                        'node_modules/@tarojs/components/lib/react/index.js'
                    ),
                },
            ],
        },
        build: {
            outDir: path.join(root, 'dist-ui'),
            // es 先构建并清空目录;umd 后构建,保留 es 产物
            emptyOutDir: !isUmd,
            lib: {
                entry: path.join(root, 'src/components/index.ts'),
                name: 'MpUI',
                formats: [isUmd ? 'umd' : 'es'],
                fileName: (format) => `index.${format}.js`,
            },
            rollupOptions: {
                external: isUmd
                    ? ['react', 'react-dom']
                    : ['react', 'react-dom', 'react/jsx-runtime'],
                output: {
                    globals: { react: 'React', 'react-dom': 'ReactDOM' },
                },
            },
        },
    }
})
