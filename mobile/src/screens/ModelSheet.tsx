/**
 * 「端末のAI」の画面：モデルを選ぶ・ダウンロードする・消す
 */
import * as Device from 'expo-device';
import { Modal, Pressable, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { formatBytes, MODELS, totalBytes, type ModelSpec } from '../ai/catalog';
import { freeBytes, lastInfoError } from '../ai/modelFiles';
import { hasLlamaNative, NO_NATIVE_MESSAGE } from '../ai/native';
import type { useModels } from '../ai/useModels';
import { palette } from '../theme';

type Props = {
  visible: boolean;
  onClose: () => void;
  models: ReturnType<typeof useModels>;
  /** モデルを読み込めなかったときの理由 */
  loadError?: string | null;
};

export function ModelSheet({ visible, onClose, models, loadError }: Props) {
  const c = palette(useColorScheme());
  const ramGB = Device.totalMemory ? Device.totalMemory / 1024 ** 3 : null;
  const free = freeBytes();
  const busy = !!models.download && !models.download.error;

  const row = (m: ModelSpec) => {
    const installed = !!models.installed[m.id];
    const selected = models.modelId === m.id;
    const dl = models.download?.id === m.id ? models.download : null;
    const lowRam = ramGB !== null && ramGB < m.minRamGB * 0.9;
    const pct = dl?.progress ? Math.round(dl.progress.ratio * 100) : 0;
    return (
      <View key={m.id} style={[s.card, { backgroundColor: c.sheet, borderColor: selected && installed ? c.blue : c.rule }]}>
        <View style={s.cardHead}>
          <Text style={[s.name, { color: c.ink }]}>{m.label}</Text>
          {selected && installed ? <Text style={[s.badge, { color: c.blue, borderColor: c.blue }]}>使用中</Text> : null}
        </View>
        <Text style={[s.desc, { color: c.ink2 }]}>{m.description}</Text>
        <Text style={[s.meta, { color: c.ink3 }]}>
          ダウンロード {formatBytes(totalBytes(m))}・メモリ{m.minRamGB}GB以上推奨・{m.license}
        </Text>
        {lowRam ? <Text style={[s.warn, { color: c.warn }]}>この端末のメモリ（約{ramGB!.toFixed(0)}GB）では、動かないか、とても遅くなることがあります。</Text> : null}
        {dl && !dl.error ? (
          <View style={s.progressWrap}>
            <View style={[s.bar, { backgroundColor: c.rule }]}>
              <View style={[s.barFill, { width: `${pct}%`, backgroundColor: c.marker }]} />
            </View>
            <Text style={[s.meta, { color: c.ink2 }]}>
              {pct}%（{dl.progress?.file === 'mmproj' ? '写真を読む部分' : 'モデル本体'}）
            </Text>
            <Btn label="ダウンロードをやめる" onPress={models.cancel} c={c} />
          </View>
        ) : (
          <View style={s.actions}>
            {installed ? (
              <>
                {!selected ? <Btn label="このモデルを使う" primary onPress={() => models.select(m.id)} c={c} /> : null}
                <Btn label="削除する" onPress={() => models.remove(m.id)} c={c} />
              </>
            ) : (
              <Btn
                label={`ダウンロード（${formatBytes(totalBytes(m))}）`}
                primary
                disabled={busy || free < totalBytes(m) * 1.05}
                onPress={() => models.start(m.id)}
                c={c}
              />
            )}
          </View>
        )}
        {dl?.error ? <Text style={[s.warn, { color: c.warn }]}>{dl.error}</Text> : null}
        {!installed && free < totalBytes(m) * 1.05 ? (
          <Text style={[s.warn, { color: c.warn }]}>空き容量が足りません（あと{formatBytes(totalBytes(m) * 1.05 - free)}必要）。</Text>
        ) : null}
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[s.wrap, { backgroundColor: c.paper }]}>
        <View style={s.top}>
          <Text style={[s.title, { color: c.ink }]}>端末のAI</Text>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button">
            <Text style={[s.close, { color: c.blue }]}>閉じる</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={s.body}>
          <Text style={[s.lead, { color: c.ink2 }]}>
            AIアドバイザーは、この端末の中だけで動きます。科目・答案の写真・質問は外へ送りません。モデルは最初に1回だけダウンロードします（Wi-Fiをおすすめします）。
          </Text>
          {!hasLlamaNative() ? (
            <View style={[s.card, { backgroundColor: c.sheet, borderColor: c.warn }]}>
              <Text style={[s.name, { color: c.warn }]}>このアプリでは端末AIを動かせません</Text>
              <Text style={[s.desc, { color: c.ink2 }]}>{NO_NATIVE_MESSAGE}</Text>
            </View>
          ) : null}
          {MODELS.map(row)}
          {loadError || lastInfoError ? (
            <Text style={[s.warn, { color: c.warn }]}>
              読み込みの記録：{loadError || lastInfoError}（この文をそのまま開発者に伝えてください）
            </Text>
          ) : null}
          <Text style={[s.meta, { color: c.ink3 }]}>
            空き容量 {Number.isFinite(free) ? formatBytes(free) : '不明'}
            {ramGB !== null ? `・メモリ 約${ramGB.toFixed(0)}GB` : ''}
          </Text>
          <Text style={[s.meta, { color: c.ink3, marginTop: 12 }]}>
            モデル：Qwen3-VL（Alibaba Cloud Qwen チーム、Apache License 2.0）。推論：llama.cpp / llama.rn（MIT License）。
          </Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

function Btn({ label, onPress, primary, disabled, c }: { label: string; onPress: () => void; primary?: boolean; disabled?: boolean; c: ReturnType<typeof palette> }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        s.btn,
        primary ? { backgroundColor: c.blue, borderColor: c.blue } : { backgroundColor: c.sheet, borderColor: c.rule },
        (pressed || disabled) && { opacity: disabled ? 0.45 : 0.8 },
      ]}
    >
      <Text style={[s.btnText, { color: primary ? c.blueInk : c.ink }]}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 18, paddingBottom: 8 },
  title: { fontSize: 20, fontWeight: '700' },
  close: { fontSize: 16, fontWeight: '600' },
  body: { padding: 16, paddingBottom: 40, gap: 12 },
  lead: { fontSize: 14, lineHeight: 22 },
  card: { borderWidth: 1, borderRadius: 6, padding: 14, gap: 6 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  name: { fontSize: 16, fontWeight: '700', flexShrink: 1 },
  badge: { fontSize: 12, fontWeight: '700', borderWidth: 1, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1 },
  desc: { fontSize: 14, lineHeight: 21 },
  meta: { fontSize: 12.5, lineHeight: 19 },
  warn: { fontSize: 13, lineHeight: 19 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  progressWrap: { gap: 6, marginTop: 4 },
  bar: { height: 10, borderRadius: 5, overflow: 'hidden' },
  barFill: { height: 10 },
  btn: { minHeight: 44, paddingHorizontal: 16, borderRadius: 6, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontSize: 15, fontWeight: '700' },
});
