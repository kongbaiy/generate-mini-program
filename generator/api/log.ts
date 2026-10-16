import { NodeServer } from '../core'

const api = new NodeServer()

export const buildError = () => api.post('')
