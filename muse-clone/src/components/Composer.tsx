import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../lib/theme';

export default function Composer({ onSend }: { onSend: (text: string) => void }) {
  const [text, setText] = useState('');

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText('');
  };

  return (
    <View style={styles.wrap}>
      <Pressable style={styles.iconBtn} onPress={() => {}} hitSlop={8}>
        <Ionicons name="add" size={22} color={theme.muted} />
      </Pressable>
      <TextInput
        style={styles.input}
        value={text}
        onChangeText={setText}
        placeholder="Message Raven…"
        placeholderTextColor={theme.muted}
        multiline
        maxLength={2000}
        returnKeyType="send"
        onSubmitEditing={submit}
        blurOnSubmit={false}
      />
      <Pressable style={styles.iconBtn} onPress={() => {}} hitSlop={8}>
        <Ionicons name="mic-outline" size={20} color={theme.muted} />
      </Pressable>
      <Pressable
        style={[styles.sendBtn, !text.trim() && styles.sendBtnDisabled]}
        onPress={submit}
        disabled={!text.trim()}
      >
        <Ionicons name="arrow-up" size={18} color={text.trim() ? '#0B0B0F' : theme.muted} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: theme.surface,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: 6,
    paddingVertical: 6,
    marginHorizontal: 12,
    marginBottom: 10,
  },
  iconBtn: { padding: 8, justifyContent: 'center' },
  input: {
    flex: 1,
    color: theme.text,
    fontSize: 15,
    maxHeight: 120,
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  sendBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
  },
  sendBtnDisabled: { backgroundColor: theme.surface2 },
});
