import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

const root = path.resolve(__dirname.replace('/config', ''))

export default defineConfig({
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
                replacement: path.join(root, 'node_modules/@tarojs/components/lib/react/index.js'),
            },
        ],
    },
    build: {
        outDir: path.join(root, 'dist-ui'),
        emptyOutDir: true,
        lib: {
            entry: path.join(root, 'src/components/index.ts'),
            name: 'MpUI',
            formats: ['es', 'umd'],
            fileName: (format) => `index.${format}.js`,
        },
        rollupOptions: {
            external: ['react', 'react-dom'],
            output: {
                globals: { react: 'React', 'react-dom': 'ReactDOM' },
            },
        },
    },
})
