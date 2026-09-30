import { createProject } from './engineer'

createProject({
    projectName: 'test',
    copyFiles: [
        'config',
        'types',
        'src/pages/home',
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
