// src/app/explore.tsx
import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, type ThemeName } from '@/hooks/use-theme';

const THEME_OPTIONS: { name: ThemeName; label: string; icon: string }[] = [
  { name: 'light', label: 'Light', icon: '☀️' },
  { name: 'dark', label: 'Dark', icon: '🌙' },
  { name: 'system', label: 'System', icon: '⚙️' },
];

export default function ExploreScreen() {
  const { savedTheme, setTheme } = useTheme();

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-neutral-850">
      <ScrollView contentContainerClassName="px-6 py-8 gap-8">
        <View className="gap-1">
          <Text className="text-3xl font-bold text-neutral-900 dark:text-white">
            Appearance
          </Text>
          <Text className="text-base text-neutral-500 dark:text-neutral-400">
            Choose how Zevra looks
          </Text>
        </View>

        <View className="gap-3">
          {THEME_OPTIONS.map((opt) => {
            const active = savedTheme === opt.name;
            return (
              <Pressable
                key={opt.name}
                onPress={() => setTheme(opt.name)}
                className={`flex-row items-center gap-4 rounded-2xl border-2 px-5 py-4 active:opacity-80 ${
                  active
                    ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/30'
                    : 'border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900'
                }`}
              >
                <Text className="text-2xl">{opt.icon}</Text>
                <Text
                  className={`flex-1 text-lg font-semibold ${
                    active
                      ? 'text-blue-700 dark:text-blue-400'
                      : 'text-neutral-900 dark:text-white'
                  }`}
                >
                  {opt.label}
                </Text>
                {active && (
                  <View className="h-6 w-6 rounded-full bg-blue-600 items-center justify-center">
                    <Text className="text-white text-xs font-bold">✓</Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>

        <Text className="text-xs text-neutral-400 dark:text-neutral-600 text-center">
          Your choice is saved automatically
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}