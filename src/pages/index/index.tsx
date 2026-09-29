import { useLoad } from '@tarojs/taro'

import Button from '@/components/button'

export default function Index () {
  useLoad(() => {
    console.log('Page loaded.')
  })

  return (
   <Button></Button>
  )
}
