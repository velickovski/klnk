import {StyleSheet} from 'react-native';
import {typeRoles,type UIColors} from './tokens';
export function createUIStyles(colors:UIColors,inset=24) {return StyleSheet.create({
  page:{padding:inset,gap:24,paddingBottom:40},row:{flexDirection:'row',alignItems:'center',gap:12},spread:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12,flexWrap:'wrap'},
  title:{...typeRoles.hero,color:colors.ink,letterSpacing:-.7},subtitle:{...typeRoles.body,color:colors.muted},label:{...typeRoles.caption,color:colors.muted},text:{...typeRoles.body,color:colors.ink},small:{...typeRoles.supporting,color:colors.muted},h2:{...typeRoles.section,color:colors.ink},h3:{...typeRoles.action,color:colors.ink},
  card:{backgroundColor:colors.white,borderRadius:24,padding:20,borderWidth:1,borderColor:colors.line,gap:16},divider:{height:1,backgroundColor:colors.line},button:{minHeight:52,paddingVertical:13,paddingHorizontal:18,borderRadius:16,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:10},field:{borderWidth:1,borderColor:colors.line,borderRadius:16,backgroundColor:colors.white,paddingHorizontal:16,paddingVertical:13,color:colors.ink,...typeRoles.body,minHeight:52},chips:{flexDirection:'row',flexWrap:'wrap',gap:8},
});}
