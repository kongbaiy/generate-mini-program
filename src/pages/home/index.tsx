import React from 'react'
import { View } from '@tarojs/components'

import List from '../../components/list'
import styles from './index.module.scss'


export default class Index extends React.Component {
    render() {
        return (
            <>
                <View className={styles.red}>11</View>
                <List />
            </>
        )
    }
}
