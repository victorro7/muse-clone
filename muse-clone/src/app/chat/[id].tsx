import { useLayoutEffect } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useChat } from '../../lib/store';
import { theme } from '../../lib/theme';
import MessageBubble from '../../components/MessageBubble';
import TypingDots from '../../components/TypingDots';
import Composer from '../../components/Composer';

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getConversation, sendMessage, isTyping } = useChat();
  const navigation = useNavigation();

  const convo = getConversation(id);
  const typing = isTyping(id);

  useLayoutEffect(() => {
    navigation.setOptions({ title: convo?.title ?? 'Chat' });
  }, [navigation, convo?.title]);

  if (!convo) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>This chat no longer exists.</Text>
      </View>
    );
  }

  const data = typing ? [...convo.messages, { id: '__typing', role: 'assistant' as const, text: '', createdAt: 0 }] : convo.messages;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={88}
    >
      {convo.messages.length === 0 && !typing ? (
        <View style={styles.welcome}>
          <View style={styles.logoRing}>
            <Ionicons name="sparkles" size={30} color={theme.accent} />
          </View>
          <Text style={styles.welcomeTitle}>Raven</Text>
          <Text style={styles.welcomeSub}>Your demo AI companion.{'\n'}Ask me anything below.</Text>
        </View>
      ) : (
        <FlatList
          data={[...data].reverse()}
          keyExtractor={(m) => m.id}
          inverted
          contentContainerStyle={styles.list}
          renderItem={({ item }) =>
            item.id === '__typing' ? <TypingDots /> : <MessageBubble message={item} />
          }
        />
      )}
      <Composer onSend={(text) => sendMessage(id, text)} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  center: { flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' },
  muted: { color: theme.muted, fontSize: 15 },
  list: { paddingVertical: 12 },
  welcome: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 32 },
  logoRing: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: theme.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  welcomeTitle: { color: theme.text, fontSize: 24, fontWeight: '700' },
  welcomeSub: { color: theme.muted, fontSize: 15, textAlign: 'center', lineHeight: 22 },
});
