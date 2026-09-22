import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ChatProvider } from '../lib/store';
import { theme } from '../lib/theme';

export default function RootLayout() {
  return (
    <ChatProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.bg },
          headerTintColor: theme.text,
          headerTitleStyle: { fontWeight: '600' },
          contentStyle: { backgroundColor: theme.bg },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Muse' }} />
        <Stack.Screen name="chat/[id]" options={{ title: 'Chat' }} />
      </Stack>
    </ChatProvider>
  );
}
