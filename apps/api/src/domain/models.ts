import { desc } from "drizzle-orm";
import { db, schema } from "../db/client";
import { intel } from "../intel/client";

interface IntelModel {
  model_name: string;
  version: string;
  algorithm: string;
  dataset_source: string;
  training_date: string;
  metrics: Record<string, unknown>;
  baseline_metrics: Record<string, unknown>;
  beats_baseline: boolean;
  is_active: boolean;
  label: string;
  validation?: unknown;
  features?: string[];
}

/** Mirrors the intelligence service's model registry into Postgres (model_versions). */
export async function syncModelRegistry() {
  const models = await intel<IntelModel[]>("/models", null, { method: "GET", timeoutMs: 5000, retries: 1 });
  for (const m of models) {
    await db
      .insert(schema.modelVersions)
      .values({ modelName: m.model_name, version: m.version, algorithm: m.algorithm, datasetSource: m.dataset_source, trainingDate: new Date(m.training_date), metrics: m.metrics, baselineMetrics: m.baseline_metrics, beatsBaseline: m.beats_baseline, isActive: m.is_active, label: m.label, details: { validation: m.validation ?? null, features: m.features ?? [] } })
      .onConflictDoUpdate({ target: [schema.modelVersions.modelName, schema.modelVersions.version], set: { isActive: m.is_active, metrics: m.metrics, baselineMetrics: m.baseline_metrics, beatsBaseline: m.beats_baseline } });
  }
  return models.length;
}

export async function listModels() {
  let synced = true;
  try {
    await syncModelRegistry();
  } catch {
    synced = false;
  }
  const rows = await db.select().from(schema.modelVersions).orderBy(desc(schema.modelVersions.trainingDate));
  return { intelligenceReachable: synced, models: rows };
}
