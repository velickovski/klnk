import React, { useEffect, useState } from 'react';
import { AppState, Image, StyleSheet, View } from 'react-native';
import Animated, { cubicBezier, useReducedMotion } from 'react-native-reanimated';
import { brand, motion } from '../../design/tokens';
import { useDesign } from '../../design/ThemeProvider';

const entrance = {
  from: { opacity: 0, transform: [{ translateY: 12 }, { scale: 0.96 }] },
  to: { opacity: 1, transform: [{ translateY: 0 }, { scale: 1 }] },
};

/** Finite decoration only. No loop, audio-reactive state, or capture side effects. */
export function LaunchArtwork({ size, resting }: { size: number; resting: boolean }) {
  const { reducedMotion } = useDesign();
  const systemReducedMotion = useReducedMotion();
  const [interrupted, setInterrupted] = useState(AppState.currentState !== 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') setInterrupted(true);
    });
    return () => subscription.remove();
  }, []);
  const animate = resting && !reducedMotion && !systemReducedMotion && !interrupted;
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-hidden
      style={s.area}
    >
      <View style={[s.orbit, { width: size * 1.25, height: size * 0.48 }]} />
      <Animated.View
        testID="launch-artwork"
        style={
          animate
            ? {
                animationName: entrance,
                animationDuration: motion.entranceMs,
                animationTimingFunction: cubicBezier(0.23, 1, 0.32, 1),
                animationIterationCount: 1,
              }
            : undefined
        }
      >
        <Image
          source={require('../../../assets/klnk-presence.png')}
          resizeMode="contain"
          accessible={false}
          style={{ width: size, height: size }}
        />
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  area: { alignItems: 'center', justifyContent: 'center', paddingVertical: 8 },
  orbit: {
    position: 'absolute',
    borderRadius: 999,
    backgroundColor: brand.artworkSurface,
    transform: [{ rotate: '-22deg' }],
  },
});
