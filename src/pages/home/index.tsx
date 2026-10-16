import React from 'react'
import { View } from '@tarojs/components'

import List from '../../components/list'
import ButtonComponent from '../../components/button'
import styles from './index.module.scss'


export default class Index extends React.Component {
    render() {
        return (
            <>
                <ButtonComponent></ButtonComponent>
                <View className={styles.red}>22</View>yes
                <List />
            </>
        )
    }
}
