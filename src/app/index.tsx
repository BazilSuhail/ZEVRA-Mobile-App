// src/app/index.tsx
import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/hooks/use-theme';

export default function HomeScreen() {
  const { activeTheme, toggleTheme, isReady } = useTheme();

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-neutral-950">
      <ScrollView contentContainerClassName="px-6 py-8 gap-6">
        {/* Header with toggle */}
        <View className="flex-row items-center justify-between">
          <View className="gap-1">
            <Text className="text-3xl font-bold text-neutral-900 dark:text-white">
              Zevra
            </Text>
            <Text className="text-base text-neutral-500 dark:text-neutral-400">
              Chat app
            </Text>
          </View>

          <Pressable
            onPress={toggleTheme}
            disabled={!isReady}
            className="h-12 w-12 rounded-full bg-neutral-100 dark:bg-neutral-800 items-center justify-center active:opacity-70"
          >
            <Text className="text-xl">
              {activeTheme === 'dark' ? '☀️' : '🌙'}
            </Text>
          </Pressable>
        </View>

        {/* Your existing home content */}
        <View className="gap-3 mt-4">
          <Text className="text-neutral-900 dark:text-white text-base">
            Tap the icon to switch theme
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}