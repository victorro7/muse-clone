import { useLayoutEffect } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Link, router, useNavigation } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { timeAgo, useChat } from '../lib/store';
import { theme } from '../lib/theme';

export default function ChatListScreen() {
  const { conversations, createConversation, deleteConversation } = useChat();
  const navigation = useNavigation();

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={() => router.push(`/chat/${createConversation()}`)}
          hitSlop={10}
          style={styles.headerBtn}
        >
          <Ionicons name="square-outline" size={20} color={theme.accent} />
          <Ionicons name="pencil" size={12} color={theme.accent} style={styles.pencil} />
        </Pressable>
      ),
    });
  }, [navigation, createConversation]);

  const confirmDelete = (id: string, title: string) => {
    Alert.alert('Delete chat', `Delete "${title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteConversation(id) },
    ]);
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={conversations}
        keyExtractor={(c) => c.id}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="chatbubbles-outline" size={48} color={theme.muted} />
            <Text style={styles.emptyTitle}>No conversations yet</Text>
            <Text style={styles.emptySub}>Tap the compose button to start one.</Text>
          </View>
        }
        renderItem={({ item }) => {
          const preview = item.messages[item.messages.length - 1]?.text ?? 'New conversation';
          return (
            <Link href={`/chat/${item.id}`} asChild>
              <Pressable
                style={styles.row}
                onLongPress={() => confirmDelete(item.id, item.title)}
              >
                <View style={styles.rowText}>
                  <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
                  <Text style={styles.preview} numberOfLines={1}>{preview}</Text>
                </View>
                <Text style={styles.time}>{timeAgo(item.createdAt)}</Text>
                <Ionicons name="chevron-forward" size={16} color={theme.muted} />
              </Pressable>
            </Link>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  headerBtn: { flexDirection: 'row', alignItems: 'center', marginRight: 4 },
  pencil: { marginLeft: -14, marginTop: 8 },
  list: { paddingVertical: 8 },
  sep: { height: 1, backgroundColor: theme.border, marginLeft: 16 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 8 },
  rowText: { flex: 1 },
  title: { color: theme.text, fontSize: 16, fontWeight: '600', marginBottom: 3 },
  preview: { color: theme.muted, fontSize: 14 },
  time: { color: theme.muted, fontSize: 12 },
  empty: { alignItems: 'center', paddingTop: 120, gap: 8 },
  emptyTitle: { color: theme.text, fontSize: 17, fontWeight: '600' },
  emptySub: { color: theme.muted, fontSize: 14 },
});
