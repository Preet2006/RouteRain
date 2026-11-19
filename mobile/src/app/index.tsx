import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  getApiBaseUrl,
  getEnvBaseUrl,
  hasBaseUrlOverride,
  normalizeBaseUrl,
  setApiBaseUrlOverride,
} from '@/api/baseUrl';
import { ApiError, getHealth, getScenarios } from '@/api/client';
import { colors, radius, spacing, touchTarget, typography } from '@/theme';

/**
 * Phase M3 temporary screen: calls /mobile/v1/health (and /scenarios) and shows the result.
 * Replaced by the real Home screen in a later phase.
 */
export default function HealthScreen() {
  const queryClient = useQueryClient();
  const [baseUrl, setBaseUrl] = useState(getApiBaseUrl());
  const [devOpen, setDevOpen] = useState(false);

  const health = useQuery({ queryKey: ['health', baseUrl], queryFn: getHealth, enabled: baseUrl !== '' });
  const scenarios = useQuery({ queryKey: ['scenarios', baseUrl], queryFn: getScenarios, enabled: baseUrl !== '' });

  const refreshing = health.isFetching || scenarios.isFetching;
  const refetchAll = () => {
    health.refetch();
    scenarios.refetch();
  };

  const showDev = devOpen || baseUrl === '';

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refetchAll} tintColor={colors.accent} />}>
        <Pressable
          accessibilityRole="header"
          accessibilityHint="Long press to show the developer server address field"
          onLongPress={() => setDevOpen((open) => !open)}>
          <Text style={typography.title}>RouteRain</Text>
        </Pressable>
        <Text style={[typography.caption, styles.subtitle]}>Server check · Know before you go</Text>

        <ServerCard
          baseUrl={baseUrl}
          loading={health.isPending && baseUrl !== ''}
          error={health.error}
          data={health.data}
          onRetry={refetchAll}
        />

        {scenarios.data ? (
          <Card title="Replay days">
            {scenarios.data.scenarios.map((s) => (
              <Row key={s.date} label={s.label} value={s.date} />
            ))}
            <Text style={typography.caption}>Default mode: {scenarios.data.default_mode}</Text>
          </Card>
        ) : null}

        {showDev ? (
          <DeveloperPanel
            baseUrl={baseUrl}
            onChange={(next) => {
              setBaseUrl(next);
              queryClient.invalidateQueries();
            }}
          />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function ServerCard({
  baseUrl,
  loading,
  error,
  data,
  onRetry,
}: {
  baseUrl: string;
  loading: boolean;
  error: Error | null;
  data: Awaited<ReturnType<typeof getHealth>> | undefined;
  onRetry: () => void;
}) {
  if (baseUrl === '') {
    return (
      <Card title="Server">
        <Status good={false} text="No server address set" />
        <Text style={typography.caption}>
          Paste your tunnel address in the developer field below, or set EXPO_PUBLIC_API_URL in mobile/.env.
        </Text>
      </Card>
    );
  }
  if (loading) {
    return (
      <Card title="Server">
        <View style={styles.skeleton} accessibilityLabel="Checking server" />
        <View style={[styles.skeleton, { width: '60%' }]} />
      </Card>
    );
  }
  if (error || !data) {
    const message = error instanceof ApiError ? error.message : "Can't reach RouteRain server.";
    return (
      <Card title="Server">
        <Status good={false} text={message} />
        <Text style={typography.caption}>Address: {baseUrl}</Text>
        <Text style={typography.caption}>
          Check that the backend and the tunnel are running, then try again.
        </Text>
        <Button label="Retry" onPress={onRetry} />
      </Card>
    );
  }
  return (
    <Card title="Server">
      <Status good text="Server reachable" />
      <Status good={data.ok} text={data.ok ? 'Ready' : 'Not fully ready'} />
      <Row label="Risk model" value={yesNo(data.model_loaded)} good={data.model_loaded} />
      <Row label="Road graph" value={yesNo(data.graph_loaded)} good={data.graph_loaded} />
      <Row label="Narration (AI)" value={yesNo(data.llm_available)} good={data.llm_available} />
      <Row label="Places" value={`${data.places.count} (${data.places.verified} verified)`} />
      <Row label="API version" value={data.api_version} />
      <Text style={typography.caption}>Address: {baseUrl}</Text>
    </Card>
  );
}

function DeveloperPanel({ baseUrl, onChange }: { baseUrl: string; onChange: (next: string) => void }) {
  const [text, setText] = useState(baseUrl);
  const [note, setNote] = useState('');

  const save = async () => {
    const clean = normalizeBaseUrl(text);
    if (!clean) {
      setNote('Enter a full address starting with http:// or https://');
      return;
    }
    onChange(await setApiBaseUrlOverride(clean));
    setNote('Saved. Pull down to refresh.');
  };
  const reset = async () => {
    const now = await setApiBaseUrlOverride(null);
    setText(now);
    onChange(now);
    setNote(now ? 'Back to the address built into the app.' : 'Cleared.');
  };

  return (
    <Card title="Developer: server address">
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="https://something.trycloudflare.com"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        accessibilityLabel="Server address"
        style={styles.input}
      />
      <View style={styles.buttonRow}>
        <Button label="Save" onPress={save} />
        <Button label="Reset" onPress={reset} secondary />
      </View>
      <Text style={typography.caption}>
        {hasBaseUrlOverride() ? 'Using the address you saved.' : 'Using the address built into the app.'}
        {getEnvBaseUrl() ? '' : ' (none built in)'}
      </Text>
      {note ? <Text style={typography.caption}>{note}</Text> : null}
    </Card>
  );
}

// ---- small building blocks ---------------------------------------------------------------

const yesNo = (value: boolean) => (value ? 'Yes' : 'No');

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <Text style={typography.heading}>{title}</Text>
      {children}
    </View>
  );
}

/** Colour is never the only signal: every status also has a glyph and a word. */
function Status({ good, text }: { good: boolean; text: string }) {
  return (
    <Text style={[typography.body, { color: good ? colors.good : colors.danger, fontWeight: '600' }]}>
      {good ? '✓ ' : '✕ '}
      {text}
    </Text>
  );
}

function Row({ label, value, good }: { label: string; value: string; good?: boolean }) {
  const glyph = good === undefined ? '' : good ? '✓ ' : '✕ ';
  return (
    <View style={styles.row} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={typography.body}>{label}</Text>
      <Text style={[typography.body, good === undefined ? null : { color: good ? colors.good : colors.danger }]}>
        {glyph}
        {value}
      </Text>
    </View>
  );
}

function Button({ label, onPress, secondary }: { label: string; onPress: () => void; secondary?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.button, secondary && styles.buttonSecondary, pressed && { opacity: 0.7 }]}>
      <Text style={[styles.buttonText, secondary && { color: colors.text }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.lg },
  subtitle: { marginTop: -spacing.sm },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, minHeight: 32, alignItems: 'center' },
  skeleton: { height: 18, borderRadius: radius.sm, backgroundColor: colors.surfaceRaised, width: '90%' },
  input: {
    minHeight: touchTarget,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    color: colors.text,
    paddingHorizontal: spacing.md,
    fontSize: 16,
  },
  buttonRow: { flexDirection: 'row', gap: spacing.md },
  button: {
    minHeight: touchTarget,
    minWidth: touchTarget * 2,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  buttonSecondary: { backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border },
  buttonText: { color: colors.onAccent, fontSize: 16, fontWeight: '600' },
});
