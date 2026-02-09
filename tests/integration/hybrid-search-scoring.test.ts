import {
  afterAll,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { join } from "node:path";
import { createMemorySystem } from "../../src/index.ts";
import type { MemorySystem } from "../../src/index.ts";
import {
  cleanupTempDir,
  createTempDir,
} from "../helpers/fixtures.ts";

const TEST_TIMEOUT = 120_000;

describe("Hybrid Search Scoring", () => {
  let tempDir: string;
  let system: MemorySystem;

  beforeAll(async () => {
    tempDir = await createTempDir();
    system = createMemorySystem({
      baseDir: tempDir,
      sqlitePath: join(tempDir, ".index", "search.sqlite"),
    });
    await system.start();

    // Index 5+ German test documents, all created at the same time
    const now = Date.now();
    const docs = [
      {
        id: "doc-dsgvo",
        title: "DSGVO Compliance",
        content:
          "Datenschutz-Grundverordnung: Compliance-Anforderungen für Healthcare-Unternehmen. " +
          "Patientendaten müssen verschlüsselt gespeichert werden. Aufbewahrungsfristen und " +
          "Löschkonzepte sind gesetzlich vorgeschrieben. Privacy by Design ist Pflicht.",
      },
      {
        id: "doc-saas",
        title: "SaaS Metriken",
        content:
          "Recurring Revenue und SaaS-Marge: Skalierung durch Product-Led Growth. " +
          "Monthly Recurring Revenue (MRR) als Kernmetrik. Churn Rate unter 5% halten. " +
          "Customer Acquisition Cost (CAC) muss unter dem Lifetime Value liegen.",
      },
      {
        id: "doc-ki",
        title: "KI Architekturen",
        content:
          "Transformer-Architekturen und Large Language Models: Attention-Mechanismus, " +
          "Tokenizer-Strategien und Fine-Tuning-Methoden. LoRA und QLoRA für effizientes " +
          "Training auf Consumer-Hardware. Prompt Engineering Best Practices.",
      },
      {
        id: "doc-devops",
        title: "DevOps Pipeline",
        content:
          "CI/CD Pipeline mit GitHub Actions: Container-Orchestrierung mit Kubernetes. " +
          "Infrastructure as Code mit Terraform. Monitoring und Alerting via Prometheus " +
          "und Grafana. Zero-Downtime Deployments mit Blue-Green Strategy.",
      },
      {
        id: "doc-ux",
        title: "UX Research",
        content:
          "Nutzerzentriertes Design und User Experience Research: Usability-Tests, " +
          "A/B-Testing-Frameworks und Conversion-Optimierung. Jobs-to-be-Done-Framework " +
          "für Produktentwicklung. Design Thinking Workshops und Prototyping.",
      },
      {
        id: "doc-security",
        title: "IT Security",
        content:
          "Penetration Testing und Schwachstellenanalyse: OWASP Top 10, SQL Injection, " +
          "Cross-Site Scripting. Security Audit und Compliance-Prüfung nach ISO 27001. " +
          "Zero Trust Architecture und Identity Access Management.",
      },
    ];

    for (const doc of docs) {
      const embedding = await system.embedding.embed(doc.content);
      const memory = {
        metadata: {
          id: doc.id,
          title: doc.title,
          type: "semantic" as const,
          tags: ["test"],
          importance: "medium" as const,
          createdAt: now,
          updatedAt: now,
          lastAccessedAt: now,
          source: "test",
        },
        content: doc.content,
        filePath: join(tempDir, `${doc.id}.md`),
        embedding: embedding.vector,
      };
      await system.searchIndex.index(memory as any);
    }
  }, TEST_TIMEOUT);

  afterAll(async () => {
    try {
      await system.stop();
    } catch {
      // may fail if already stopped
    }
    await cleanupTempDir(tempDir);
  }, TEST_TIMEOUT);

  test("score spread > 0.05 for a specific query", async () => {
    const queryEmbed = await system.embedding.embed(
      "DSGVO Compliance Healthcare Datenschutz",
    );
    const results = await system.searchIndex.searchHybrid(
      "DSGVO Compliance Healthcare Datenschutz",
      queryEmbed.vector,
      { limit: 6, minScore: 0 },
    );

    expect(results.length).toBeGreaterThanOrEqual(2);

    const topScore = results[0]!.score;
    const bottomScore = results[results.length - 1]!.score;
    const spread = topScore - bottomScore;

    expect(spread).toBeGreaterThan(0.05);
  }, TEST_TIMEOUT);

  test("different queries produce different top results", async () => {
    const queryA = "DSGVO Compliance Healthcare Datenschutz";
    const queryB = "Recurring Revenue SaaS Marge Skalierung";

    const embedA = await system.embedding.embed(queryA);
    const embedB = await system.embedding.embed(queryB);

    const resultsA = await system.searchIndex.searchHybrid(
      queryA,
      embedA.vector,
      { limit: 3, minScore: 0 },
    );
    const resultsB = await system.searchIndex.searchHybrid(
      queryB,
      embedB.vector,
      { limit: 3, minScore: 0 },
    );

    expect(resultsA.length).toBeGreaterThan(0);
    expect(resultsB.length).toBeGreaterThan(0);

    // Top result should differ between queries
    expect(resultsA[0]!.memory.metadata.id).not.toBe(
      resultsB[0]!.memory.metadata.id,
    );
  }, TEST_TIMEOUT);

  test("RRF spread exceeds recency contribution", async () => {
    const queryEmbed = await system.embedding.embed(
      "Transformer KI Large Language Model",
    );
    const results = await system.searchIndex.searchHybrid(
      "Transformer KI Large Language Model",
      queryEmbed.vector,
      { limit: 6, minScore: 0 },
    );

    expect(results.length).toBeGreaterThanOrEqual(2);

    const topScore = results[0]!.score;
    const bottomScore = results[results.length - 1]!.score;
    const spread = topScore - bottomScore;

    // Recency contribution is at most weightRecency * 1.0 = 0.05
    // Spread should exceed this, proving RRF dominates
    expect(spread).toBeGreaterThan(0.05);
  }, TEST_TIMEOUT);
});
