import { useEffect, useMemo } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { theme } from '../lib/theme';

export default function TypingDots() {
  const dots = useMemo(() => [new Animated.Value(0), new Animated.Value(0), new Animated.Value(0)], []);

  useEffect(() => {
    const loops = dots.map((d, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 160),
          Animated.timing(d, { toValue: 1, duration: 320, useNativeDriver: true }),
          Animated.timing(d, { toValue: 0, duration: 320, useNativeDriver: true }),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.bubble}>
      {dots.map((d, i) => (
        <Animated.View
          key={i}
          style={[
            styles.dot,
            { opacity: d.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: theme.surface,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 6,
    marginVertical: 4,
  },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: theme.muted },
});
