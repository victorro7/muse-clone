import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../lib/theme';
import type { Message } from '../lib/store';

export default function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user';
  return (
    <View style={[styles.row, isUser ? styles.rowRight : styles.rowLeft]}>
      {!isUser && (
        <View style={styles.avatar}>
          <Ionicons name="sparkles" size={14} color={theme.accent} />
        </View>
      )}
      <View style={[styles.bubble, isUser ? styles.userBubble : styles.assistantBubble]}>
        <Text style={styles.text}>{message.text}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', marginVertical: 4, paddingHorizontal: 12, alignItems: 'flex-end' },
  rowRight: { justifyContent: 'flex-end' },
  rowLeft: { justifyContent: 'flex-start' },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: theme.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  bubble: { maxWidth: '78%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  userBubble: { backgroundColor: theme.userBubble, borderBottomRightRadius: 6 },
  assistantBubble: { backgroundColor: theme.surface, borderBottomLeftRadius: 6 },
  text: { color: theme.text, fontSize: 15, lineHeight: 21 },
});
