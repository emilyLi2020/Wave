// Lightweight cache inspector embedded in the dev menu. Polls inspectCache()
// on mount + after every action so the list reflects the disk state without
// needing an external store/subscriber pattern.

import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import {
  type CacheEntry,
  clearAllModels,
  clearModel,
  ensureModel,
  formatBytes,
  inspectCache,
  type ModelId,
} from "@/runtime/model-cache";

interface PerModelBusy {
  id: ModelId;
  action: "downloading" | "clearing";
  pct?: number;
}

export default function CachePanel() {
  const [entries, setEntries] = useState<CacheEntry[]>([]);
  const [busy, setBusy] = useState<PerModelBusy | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setEntries(await inspectCache());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onDownload = async (id: ModelId) => {
    setError(null);
    setBusy({ id, action: "downloading", pct: 0 });
    try {
      await ensureModel(id, {
        onProgress: (pct) =>
          setBusy((cur) => (cur?.id === id ? { ...cur, pct } : cur)),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      await refresh();
    }
  };

  const onForce = async (id: ModelId) => {
    setError(null);
    setBusy({ id, action: "downloading", pct: 0 });
    try {
      await ensureModel(id, {
        force: true,
        onProgress: (pct) =>
          setBusy((cur) => (cur?.id === id ? { ...cur, pct } : cur)),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      await refresh();
    }
  };

  const onClear = async (id: ModelId) => {
    setError(null);
    setBusy({ id, action: "clearing" });
    try {
      await clearModel(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      await refresh();
    }
  };

  const onClearAll = async () => {
    setError(null);
    try {
      await clearAllModels();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    await refresh();
  };

  const totalCached = entries.reduce(
    (sum, e) => sum + (e.cached ? e.bytes : 0),
    0,
  );

  return (
    <View style={styles.container}>
      <View style={styles.head}>
        <Text style={styles.title}>Model cache</Text>
        <Text style={styles.totalLabel}>
          on disk: {formatBytes(totalCached)}
        </Text>
      </View>

      {entries.map((entry) => {
        const isBusy = busy?.id === entry.id;
        const expected = formatBytes(entry.expectedBytes);
        const actual = entry.cached ? formatBytes(entry.bytes) : "missing";
        return (
          <View key={entry.id} style={styles.row}>
            <View style={styles.rowHead}>
              <Text style={styles.modelLabel}>{entry.label}</Text>
              <View
                style={[
                  styles.statusPill,
                  { borderColor: entry.cached ? "#34D399" : "#6B7280" },
                ]}
              >
                <Text
                  style={[
                    styles.statusText,
                    { color: entry.cached ? "#34D399" : "#6B7280" },
                  ]}
                >
                  {entry.cached ? "cached" : "missing"}
                </Text>
              </View>
            </View>
            <Text selectable style={styles.meta}>
              {actual} / {expected} expected
            </Text>
            {isBusy && busy?.action === "downloading" && (
              <View style={styles.progressRow}>
                <ActivityIndicator size="small" />
                <Text selectable style={styles.progressText}>
                  {((busy.pct ?? 0) * 100).toFixed(1)}%
                </Text>
              </View>
            )}
            <View style={styles.actionRow}>
              {!entry.cached && (
                <Pressable
                  style={[styles.smallButton, isBusy && styles.disabled]}
                  disabled={isBusy}
                  onPress={() => onDownload(entry.id)}
                >
                  <Text style={styles.smallButtonText}>Download</Text>
                </Pressable>
              )}
              {entry.cached && (
                <Pressable
                  style={[styles.smallButton, isBusy && styles.disabled]}
                  disabled={isBusy}
                  onPress={() => onForce(entry.id)}
                >
                  <Text style={styles.smallButtonText}>Re-download</Text>
                </Pressable>
              )}
              {entry.cached && (
                <Pressable
                  style={[styles.smallButtonGhost, isBusy && styles.disabled]}
                  disabled={isBusy}
                  onPress={() => onClear(entry.id)}
                >
                  <Text style={styles.smallButtonGhostText}>Clear</Text>
                </Pressable>
              )}
            </View>
          </View>
        );
      })}

      {entries.some((e) => e.cached) && (
        <Pressable style={styles.clearAllButton} onPress={onClearAll}>
          <Text style={styles.clearAllText}>Clear all caches</Text>
        </Pressable>
      )}

      {error && (
        <View style={styles.errorRow}>
          <Text selectable style={styles.errorText}>{error}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 6 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { color: "#F1F1F4", fontSize: 18, fontWeight: "700" },
  totalLabel: { color: "#9CA3AF", fontSize: 12, fontFamily: "Menlo" },
  row: {
    backgroundColor: "#16161F",
    padding: 10,
    borderRadius: 8,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: "#23232F",
    gap: 4,
    marginBottom: 4,
  },
  rowHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  modelLabel: { color: "#F1F1F4", fontSize: 13, fontWeight: "600", flex: 1, marginRight: 8 },
  meta: { color: "#9CA3AF", fontSize: 11, fontFamily: "Menlo" },
  statusPill: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  statusText: { fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1 },
  progressRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 },
  progressText: { color: "#FBBF24", fontSize: 12, fontFamily: "Menlo" },
  actionRow: { flexDirection: "row", gap: 6, marginTop: 2 },
  smallButton: {
    backgroundColor: "#6366F1",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 4,
  },
  smallButtonText: { color: "#F1F1F4", fontSize: 12, fontWeight: "600" },
  smallButtonGhost: {
    borderWidth: 1,
    borderColor: "#3F3F50",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 4,
  },
  smallButtonGhostText: { color: "#9CA3AF", fontSize: 12, fontWeight: "600" },
  disabled: { opacity: 0.4 },
  clearAllButton: {
    borderWidth: 1,
    borderColor: "#7F1D1D",
    paddingVertical: 8,
    borderRadius: 4,
    alignItems: "center",
    marginTop: 4,
  },
  clearAllText: { color: "#F87171", fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1 },
  errorRow: { borderWidth: 1, borderColor: "#7F1D1D", borderRadius: 6, padding: 8, marginTop: 4 },
  errorText: { color: "#F87171", fontSize: 12, fontFamily: "Menlo" },
});
