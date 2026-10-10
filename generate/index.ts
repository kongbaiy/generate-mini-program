import { createProject } from './engineer'

createProject({
    projectName: 'test',
    copyFiles: [],
    excludeFiles: ['src/pages', 'src/components', 'dist', 'generated', 'generate', 'schemas'],
})
