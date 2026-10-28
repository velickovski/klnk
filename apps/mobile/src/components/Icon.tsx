import React from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { View } from 'react-native';
import {useDesign} from '../design/ThemeProvider';
export type IconName=React.ComponentProps<typeof Ionicons>['name'];
export function Icon({name,color,size=22}:{name:IconName;color?:string;size?:number}) {const {colors}=useDesign();return <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden style={{minWidth:size,minHeight:size,flexShrink:0,alignItems:'center',justifyContent:'center'}}><Ionicons name={name} color={color??colors.ink} size={size} allowFontScaling={false} accessible={false}/></View>;}
