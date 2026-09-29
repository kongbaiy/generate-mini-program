import type { UserConfigExport } from "@tarojs/cli"

export default {
  mini: {},
  h5: {
    // 确保产物为 es5
    legacy: true,
  }
} satisfies UserConfigExport<'vite'>
