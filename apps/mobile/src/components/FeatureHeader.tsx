import React from 'react';
import { View } from 'react-native';
import { useDesign } from '../design/ThemeProvider';
import { radii, spacing } from '../design/tokens';
import { Icon, type IconName } from './Icon';
import { AppText } from './primitives';

/** A feature cue, never an implied action or an enabled-integration badge. */
export function FeatureHeader({
  icon,
  title,
  detail,
}: {
  icon: IconName;
  title: string;
  detail?: string;
}) {
  const { semantic } = useDesign();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}>
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: radii.control,
          backgroundColor: semantic.surfaceRaised,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={icon} color={semantic.text} size={23} />
      </View>
      <View style={{ flex: 1, gap: spacing.xs }}>
        <AppText role="section" accessibilityRole="header">
          {title}
        </AppText>
        {detail ? (
          <AppText role="supporting" style={{ color: semantic.textSecondary }}>
            {detail}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}
