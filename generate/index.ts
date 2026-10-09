import { createProject } from './engineer'

createProject({
    projectName: 'test',
    copyFiles: [
        'config',
        'types',
        'src/app.config.ts',
        'src/app.scss',
        'src/app.ts',
        'src/index.html',
        '.editorconfig',
        '.env.development',
        '.env.production',
        '.env.test',
        '.eslintrc',
        '.prettierrc',
        'babel.config.js',
        'commitlint.config.mjs',
        'package.json',
        'pnpm-workspace.yaml',
        'project.config.json',
        'stylelint.config.mjs',
        'tsconfig.json',
    ],
})
