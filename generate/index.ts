import { createProject } from './engineer'

createProject({
    projectName: 'test',
    copyFiles: [],
    excludeFiles: [
        'src/pages',
        'src/components',
        'dist',
        'node_modules',
        'generated',
        'generate',
        'schemas',
        '.swc',
        '.vscode',
    ],
})
