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
import { cleanupTempDir, createTempDir } from "../helpers/fixtures.ts";

const TEST_TIMEOUT = 120_000;

// ---------------------------------------------------------------------------
// Corpus: 18 realistic documents (German/English mix, all knowledge types)
// ---------------------------------------------------------------------------

interface CorpusDoc {
  id: string;
  title: string;
  content: string;
  type: "semantic" | "episodic" | "procedural";
  tags: string[];
}

const CORPUS: CorpusDoc[] = [
  {
    id: "dec-001",
    title: "Stundensatz-Entscheidung",
    content:
      "Entscheidung: Stundensatz für KI-Projekte auf 150 EUR festgelegt. " +
      "Begründung: Der Markt für KI-Services liegt zwischen 120-180 EUR. " +
      "Kunden im Healthcare-Bereich akzeptieren höhere Sätze wegen Compliance-Anforderungen. " +
      "Für Bestandskunden gilt ein Rabatt von 10%. Pricing muss jährlich überprüft werden.",
    type: "semantic",
    tags: ["business/pricing", "consulting"],
  },
  {
    id: "dec-002",
    title: "Tech-Stack für Patient-Portal",
    content:
      "Entscheidung: Next.js mit TypeScript als Frontend-Framework für das Patientenportal. " +
      "React Server Components für bessere Performance. Tailwind CSS für Styling. " +
      "Begründung: SSR wichtig für SEO und Ladezeiten. TypeScript reduziert Bugs. " +
      "Alternative Vue.js wurde verworfen wegen kleinerem Healthcare-Ökosystem.",
    type: "semantic",
    tags: ["tech/frontend", "healthcare"],
  },
  {
    id: "dec-003",
    title: "Datenbank-Migration zu PostgreSQL",
    content:
      "Entscheidung: Migration von MySQL zu PostgreSQL für das Hauptprojekt. " +
      "Begründung: Bessere JSON-Unterstützung, PostGIS für Standortsuche, " +
      "Row-Level Security für mandantenfähige Datenisolierung. " +
      "Zeitplan: 6 Wochen Migration mit Blue-Green Deployment. " +
      "Risiko: Abweichende SQL-Syntax bei gespeicherten Prozeduren.",
    type: "semantic",
    tags: ["tech/database", "architecture"],
  },
  {
    id: "dec-004",
    title: "KI-Modell für Befund-Analyse",
    content:
      "Entscheidung: Fine-Tuning von Llama 3 für medizinische Befundanalyse. " +
      "Ablehnung von GPT-4 API wegen Datenschutzbedenken (Patientendaten in US-Cloud). " +
      "On-Premise Deployment auf eigener GPU-Infrastruktur (NVIDIA A100). " +
      "Trainingsdaten: 50.000 anonymisierte Befunde nach DSGVO-konformer Anonymisierung. " +
      "Evaluationsmetrik: F1-Score > 0.92 auf dem Testdatensatz.",
    type: "semantic",
    tags: ["tech/ai", "healthcare"],
  },
  {
    id: "inc-001",
    title: "Produktionsausfall API-Gateway",
    content:
      "Incident: API-Gateway am 15.03. für 45 Minuten ausgefallen. " +
      "Ursache: Memory Leak im Connection-Pooling nach dem letzten Deployment. " +
      "Auswirkung: 200 Patienten konnten keine Termine buchen. " +
      "Lösung: Rollback auf vorherige Version, anschließend Hotfix mit Connection-Timeout. " +
      "Maßnahme: Monitoring für Connection-Pool-Größe eingerichtet.",
    type: "episodic",
    tags: ["incident/production", "healthcare"],
  },
  {
    id: "inc-002",
    title: "DSGVO-Datenpanne bei Kundenprojekt",
    content:
      "Incident: Unverschlüsselte Patientendaten in Log-Dateien entdeckt. " +
      "Datenschutz-Grundverordnung erfordert sofortige Meldung an Aufsichtsbehörde. " +
      "Ursache: Debug-Logging im Produktivsystem nicht deaktiviert. " +
      "Alle betroffenen Log-Dateien wurden gelöscht, Logging-Framework angepasst. " +
      "DSGVO-Schulung für Entwicklerteam geplant.",
    type: "episodic",
    tags: ["incident/security", "compliance/dsgvo"],
  },
  {
    id: "ent-001",
    title: "MedTech Solutions GmbH",
    content:
      "Kunde: MedTech Solutions GmbH, Hamburg. Ansprechpartner: Dr. Sarah Klein. " +
      "Branche: Medizintechnik und digitale Gesundheitsanwendungen (DiGA). " +
      "Projekte: Patientenportal, Telemedizin-Plattform, KI-gestützte Diagnostik. " +
      "Vertragslaufzeit bis 2026. Budget: 500k EUR jährlich. " +
      "Besonderheit: Strenge regulatorische Anforderungen (MDR, DSGVO).",
    type: "semantic",
    tags: ["client", "healthcare"],
  },
  {
    id: "ent-002",
    title: "Dr. Sarah Klein",
    content:
      "Kontakt: Dr. Sarah Klein, CTO bei MedTech Solutions GmbH. " +
      "Zuständig für technische Entscheidungen und Architektur. " +
      "Kommunikation bevorzugt per E-Mail, technisch versiert. " +
      "Hintergrund: Promotion in Medizininformatik. " +
      "Wichtig: Legt großen Wert auf Datenschutz und Compliance.",
    type: "semantic",
    tags: ["contact", "healthcare"],
  },
  {
    id: "ent-003",
    title: "Gematik Schnittstellen",
    content:
      "Entity: Gematik - Nationale Agentur für digitale Medizin. " +
      "Stellt Schnittstellen für E-Rezept, elektronische Patientenakte (ePA) bereit. " +
      "FHIR R4 als Datenstandard. Zertifizierung erforderlich für Zugang. " +
      "Testumgebung: TI-Gateway Referenzimplementierung. " +
      "Ansprechpartner im Zulassungsverfahren: Abteilung Interoperabilität.",
    type: "semantic",
    tags: ["entity/external", "healthcare"],
  },
  {
    id: "pat-001",
    title: "Retry-Pattern für externe APIs",
    content:
      "Pattern: Exponential Backoff mit Jitter für API-Aufrufe an externe Dienste. " +
      "Implementierung mit 3 Retries, Basis 1 Sekunde, Faktor 2. " +
      "Circuit Breaker nach 5 aufeinanderfolgenden Fehlern. " +
      "Besonders wichtig für Anbindung an Laborschnittstellen und KIS-Systeme. " +
      "TypeScript-Implementierung als wiederverwendbare Utility.",
    type: "procedural",
    tags: ["tech/patterns", "architecture"],
  },
  {
    id: "pat-002",
    title: "Authentifizierung mit OIDC",
    content:
      "Pattern: OpenID Connect Flow für Patientenauthentifizierung. " +
      "Identity Provider: Keycloak mit FIDO2/WebAuthn als zweitem Faktor. " +
      "Token-Refresh automatisch im Frontend, stille Erneuerung via iframe. " +
      "Rollenbasierte Zugriffskontrolle: Patient, Arzt, Verwaltung. " +
      "Session-Timeout nach 30 Minuten Inaktivität wegen DSGVO.",
    type: "procedural",
    tags: ["tech/security", "healthcare"],
  },
  {
    id: "pat-003",
    title: "Fehlerbehandlung in Microservices",
    content:
      "Pattern: Strukturierte Fehlerbehandlung über Service-Grenzen hinweg. " +
      "Einheitliches Error-Response-Format mit Fehlercode, Nachricht und Trace-ID. " +
      "Dead Letter Queue für nicht verarbeitbare Nachrichten. " +
      "Correlation-ID durch alle Services durchreichen für Debugging. " +
      "Health Checks und Readiness Probes für Kubernetes.",
    type: "procedural",
    tags: ["tech/patterns", "architecture"],
  },
  {
    id: "wf-001",
    title: "CI/CD-Pipeline Healthcare-Projekte",
    content:
      "Workflow: CI/CD Pipeline für Healthcare-Anwendungen mit strengen Qualitätsanforderungen. " +
      "GitHub Actions mit Self-Hosted Runners (DSGVO: Daten bleiben in EU). " +
      "Schritte: Lint, Typecheck, Unit-Tests, Integration-Tests, SAST-Scan, Container-Build. " +
      "Deployment nur nach manuellem Approval durch Lead Developer. " +
      "Automatische SBOM-Generierung für regulatorische Dokumentation.",
    type: "procedural",
    tags: ["tech/devops", "healthcare"],
  },
  {
    id: "wf-002",
    title: "Onboarding neuer Freelancer",
    content:
      "Workflow: Onboarding-Prozess für neue Subunternehmer im Team. " +
      "Tag 1: NDA unterschreiben, Zugang zu GitLab und Slack einrichten. " +
      "Tag 2: Architektur-Walkthrough, Coding Guidelines besprechen. " +
      "Tag 3: Erstes Pair-Programming mit erfahrenem Teammitglied. " +
      "Woche 1: Kleines Feature eigenständig umsetzen, Code Review durch Senior.",
    type: "procedural",
    tags: ["process/hr", "consulting"],
  },
  {
    id: "wf-003",
    title: "Datenschutz-Folgenabschätzung durchführen",
    content:
      "Workflow: Datenschutz-Folgenabschätzung (DSFA) nach Art. 35 DSGVO. " +
      "Schritt 1: Verarbeitungstätigkeiten dokumentieren. " +
      "Schritt 2: Notwendigkeit und Verhältnismäßigkeit prüfen. " +
      "Schritt 3: Risiken für Betroffene bewerten (Eintrittswahrscheinlichkeit x Schwere). " +
      "Schritt 4: Technische und organisatorische Maßnahmen (TOMs) definieren. " +
      "Ergebnis muss vor Projektstart vorliegen und vom DSB freigegeben werden.",
    type: "procedural",
    tags: ["compliance/dsgvo", "process"],
  },
  {
    id: "ses-001",
    title: "Session: Telemedizin Sprint Planning",
    content:
      "Sprint Planning für Telemedizin-Modul am 20.03.2025. " +
      "Videosprechstunde: WebRTC-Integration mit mediasoup als SFU. " +
      "E-Rezept-Anbindung: FHIR R4 API der Gematik. " +
      "Performance-Optimierung: Lazy Loading für Patientenakte. " +
      "Team-Kapazität: 3 Entwickler, 2 Wochen Sprint.",
    type: "episodic",
    tags: ["session", "healthcare/telemedizin"],
  },
  {
    id: "ses-002",
    title: "Session: Kosten-Review Q1",
    content:
      "Quartals-Review der Projektkosten und Wirtschaftlichkeit. " +
      "Gesamtumsatz Q1: 120k EUR, davon 80k EUR MedTech-Projekt. " +
      "Cloud-Kosten gestiegen auf 3.500 EUR/Monat (AWS eu-central-1). " +
      "Handlungsbedarf: Reserved Instances für Produktionsdatenbank evaluieren. " +
      "Stundensätze für 2026 überprüfen, Marktvergleich durchführen.",
    type: "episodic",
    tags: ["session", "business/finance"],
  },
  {
    id: "ses-003",
    title: "Session: Patientenkommunikation verbessern",
    content:
      "Workshop zur Verbesserung der digitalen Patientenkommunikation. " +
      "Ergebnisse: Chatbot für häufige Fragen, mehrsprachige Unterstützung (DE/EN/TR). " +
      "Terminbestätigung per SMS und E-Mail. Befund-Benachrichtigung push-basiert. " +
      "Barrierefreiheit: WCAG 2.1 AA als Mindeststandard. " +
      "Nächste Schritte: Prototyp in Figma, User Testing mit 10 Patienten.",
    type: "episodic",
    tags: ["session", "healthcare/ux"],
  },
];

// ---------------------------------------------------------------------------
// Queries: 24 benchmark queries in 6 categories
// ---------------------------------------------------------------------------

type QueryCategory =
  | "exact_keyword"
  | "german_morphology"
  | "compound_word"
  | "cross_language"
  | "semantic_similarity"
  | "special_chars";

interface BenchmarkQuery {
  query: string;
  expectedIds: string[];
  description: string;
  category: QueryCategory;
}

const QUERIES: BenchmarkQuery[] = [
  // --- Exact keyword matches (easy baseline) ---
  {
    query: "API-Gateway Produktionsausfall",
    expectedIds: ["inc-001"],
    description: "Exact keyword: German incident title terms",
    category: "exact_keyword",
  },
  {
    query: "PostgreSQL Migration",
    expectedIds: ["dec-003"],
    description: "Exact keyword: database migration decision",
    category: "exact_keyword",
  },
  {
    query: "Keycloak OIDC WebAuthn",
    expectedIds: ["pat-002"],
    description: "Exact keyword: specific tech terms in auth pattern",
    category: "exact_keyword",
  },
  {
    query: "FHIR Gematik E-Rezept",
    expectedIds: ["ent-003", "ses-001"],
    description: "Exact keyword: Gematik FHIR across multiple docs",
    category: "exact_keyword",
  },

  // --- German morphology (plural/singular, verb forms, adjectives) ---
  {
    query: "Stundensätze",
    expectedIds: ["dec-001", "ses-002"],
    description: "German plural: Stundensätze vs Stundensatz in corpus",
    category: "german_morphology",
  },
  {
    query: "Patientendaten verschlüsseln",
    expectedIds: ["inc-002", "dec-004"],
    description:
      "German verb form: verschlüsseln vs verschlüsselt in corpus",
    category: "german_morphology",
  },
  {
    query: "Entscheidungen",
    expectedIds: ["dec-001", "dec-002", "dec-003", "dec-004"],
    description:
      "German plural: Entscheidungen vs Entscheidung in corpus",
    category: "german_morphology",
  },
  {
    query: "Anforderung regulatorisch",
    expectedIds: ["ent-001", "wf-001", "ent-003"],
    description:
      "German adjective forms: regulatorisch vs regulatorische/regulatorischen",
    category: "german_morphology",
  },

  // --- Compound words ---
  {
    query: "Patientenkommunikation",
    expectedIds: ["ses-003"],
    description:
      "German compound: Patientenkommunikation (Patient+Kommunikation)",
    category: "compound_word",
  },
  {
    query: "Datenschutz-Folgenabschätzung",
    expectedIds: ["wf-003"],
    description: "German compound with hyphen: Datenschutz-Folgenabschätzung",
    category: "compound_word",
  },
  {
    query: "Gesundheitsanwendungen digital",
    expectedIds: ["ent-001"],
    description: "German compound: Gesundheitsanwendungen (DiGA)",
    category: "compound_word",
  },
  {
    query: "Zugriffskontrolle",
    expectedIds: ["pat-002"],
    description: "German compound: Zugriffskontrolle (Zugriff+Kontrolle)",
    category: "compound_word",
  },

  // --- Cross-language synonyms ---
  {
    query: "Pricing AI services",
    expectedIds: ["dec-001"],
    description:
      "Cross-language: English 'Pricing' for German Stundensatz/Kosten",
    category: "cross_language",
  },
  {
    query: "Patient communication chatbot",
    expectedIds: ["ses-003"],
    description:
      "Cross-language: English terms for German Patientenkommunikation",
    category: "cross_language",
  },
  {
    query: "Data privacy compliance regulation",
    expectedIds: ["inc-002", "wf-003", "dec-004"],
    description: "Cross-language: English for DSGVO/Datenschutz concepts",
    category: "cross_language",
  },
  {
    query: "Cost review cloud infrastructure",
    expectedIds: ["ses-002"],
    description: "Cross-language: English for Kosten-Review/Cloud-Kosten",
    category: "cross_language",
  },

  // --- Semantic similarity (no keyword overlap) ---
  {
    query: "Wie schützen wir sensible Gesundheitsdaten?",
    expectedIds: ["inc-002", "pat-002", "wf-003", "dec-004"],
    description:
      "Semantic: data protection question without exact DSGVO keyword",
    category: "semantic_similarity",
  },
  {
    query: "Fehler in verteilten Systemen behandeln",
    expectedIds: ["pat-001", "pat-003"],
    description:
      "Semantic: error handling (synonym for retry/circuit breaker)",
    category: "semantic_similarity",
  },
  {
    query: "Wie integrieren wir neue Teammitglieder?",
    expectedIds: ["wf-002"],
    description: "Semantic: onboarding question without 'Onboarding' keyword",
    category: "semantic_similarity",
  },
  {
    query: "Machine Learning im Gesundheitswesen einsetzen",
    expectedIds: ["dec-004", "ent-001"],
    description:
      "Semantic: ML in healthcare without mentioning specific model names",
    category: "semantic_similarity",
  },

  // --- Special characters / hyphenated terms ---
  {
    query: "CI/CD Pipeline",
    expectedIds: ["wf-001"],
    description: "Special chars: CI/CD with slash",
    category: "special_chars",
  },
  {
    query: "KI-Services",
    expectedIds: ["dec-001"],
    description: "Special chars: hyphenated German tech term",
    category: "special_chars",
  },
  {
    query: "WCAG 2.1 Barrierefreiheit",
    expectedIds: ["ses-003"],
    description: "Special chars: WCAG version number + accessibility",
    category: "special_chars",
  },
  {
    query: "Blue-Green Deployment",
    expectedIds: ["dec-003", "wf-001"],
    description: "Special chars: hyphenated deployment strategy",
    category: "special_chars",
  },
];

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

interface QueryResult {
  query: string;
  description: string;
  category: QueryCategory;
  expectedIds: string[];
  returnedIds: string[];
  scores: number[];
  precisionAt3: number;
  mrr: number;
  scoreSpread: number;
  scoreMin: number;
  scoreMax: number;
  vectorFallback: boolean;
}

/**
 * Precision@K: fraction of top-K results that are in the expected set.
 * Denominator is min(k, expectedIds.length) so a single expected doc
 * found in top 3 scores 1.0, not 0.33.
 */
function precisionAtK(
  returnedIds: string[],
  expectedIds: string[],
  k: number,
): number {
  const topK = returnedIds.slice(0, k);
  const expectedSet = new Set(expectedIds);
  const relevant = topK.filter((id) => expectedSet.has(id)).length;
  return relevant / Math.min(k, Math.max(expectedIds.length, 1));
}

/**
 * MRR: reciprocal rank of first relevant result (0 if none found in results).
 */
function reciprocalRank(
  returnedIds: string[],
  expectedIds: string[],
): number {
  const expectedSet = new Set(expectedIds);
  for (let i = 0; i < returnedIds.length; i++) {
    const id = returnedIds[i];
    if (id && expectedSet.has(id)) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

/**
 * Score spread: difference between highest and lowest score.
 */
function calcScoreSpread(scores: number[]): number {
  if (scores.length < 2) return 0;
  const top = scores[0] ?? 0;
  const bottom = scores[scores.length - 1] ?? 0;
  return top - bottom;
}

// ---------------------------------------------------------------------------
// Console summary
// ---------------------------------------------------------------------------

function pad(s: string, len: number): string {
  return s.length >= len ? s.slice(0, len) : s + " ".repeat(len - s.length);
}

function trunc(s: string, len: number): string {
  return s.length <= len ? s : s.slice(0, len - 2) + "..";
}

function printSummary(results: QueryResult[]): void {
  console.log("\n" + "=".repeat(120));
  console.log("  SEARCH BENCHMARK SUMMARY");
  console.log("=".repeat(120));

  // Per-query table
  console.log(
    "\n" +
      pad("Query", 42) +
      pad("Category", 22) +
      pad("P@3", 7) +
      pad("MRR", 7) +
      pad("MaxScr", 9) +
      pad("Spread", 9) +
      "Top 3 returned",
  );
  console.log("-".repeat(120));

  for (const r of results) {
    const top3 = r.returnedIds.slice(0, 3).join(", ");
    const miss = r.mrr === 0 ? " [MISS]" : "";
    const fts = r.vectorFallback ? " [VEC-ONLY]" : "";
    console.log(
      pad(trunc(r.query, 40), 42) +
        pad(r.category, 22) +
        pad(r.precisionAt3.toFixed(2), 7) +
        pad(r.mrr.toFixed(2), 7) +
        pad(r.scoreMax.toFixed(4), 9) +
        pad(r.scoreSpread.toFixed(4), 9) +
        top3 +
        miss +
        fts,
    );
  }

  // Category aggregates
  console.log("\n" + "-".repeat(75));
  console.log(
    pad("Category", 25) +
      pad("Queries", 10) +
      pad("Avg P@3", 10) +
      pad("Avg MRR", 10) +
      pad("Avg Spread", 12) +
      "Misses",
  );
  console.log("-".repeat(75));

  const categories = [...new Set(results.map((r) => r.category))];
  for (const cat of categories) {
    const catResults = results.filter((r) => r.category === cat);
    const avgP3 =
      catResults.reduce((s, r) => s + r.precisionAt3, 0) / catResults.length;
    const avgMRR =
      catResults.reduce((s, r) => s + r.mrr, 0) / catResults.length;
    const avgSpread =
      catResults.reduce((s, r) => s + r.scoreSpread, 0) / catResults.length;
    const misses = catResults.filter((r) => r.mrr === 0).length;

    console.log(
      pad(cat, 25) +
        pad(String(catResults.length), 10) +
        pad(avgP3.toFixed(3), 10) +
        pad(avgMRR.toFixed(3), 10) +
        pad(avgSpread.toFixed(4), 12) +
        String(misses),
    );
  }

  // Global summary
  const globalP3 =
    results.reduce((s, r) => s + r.precisionAt3, 0) / results.length;
  const globalMRR =
    results.reduce((s, r) => s + r.mrr, 0) / results.length;
  const totalMisses = results.filter((r) => r.mrr === 0).length;

  const allMaxScores = results
    .filter((r) => r.scores.length > 0)
    .map((r) => r.scoreMax);
  const allMinScores = results
    .filter((r) => r.scores.length > 0)
    .map((r) => r.scoreMin);
  const globalMax =
    allMaxScores.length > 0 ? Math.max(...allMaxScores) : 0;
  const globalMin =
    allMinScores.length > 0 ? Math.min(...allMinScores) : 0;

  console.log("\n" + "=".repeat(75));
  console.log(
    `  OVERALL:  P@3 = ${globalP3.toFixed(3)}   MRR = ${globalMRR.toFixed(3)}`,
  );
  console.log(
    `  Score range: [${globalMin.toFixed(4)}, ${globalMax.toFixed(4)}]`,
  );
  console.log(
    `  Misses (no relevant result in top 10): ${totalMisses}/${results.length}`,
  );
  console.log("=".repeat(75) + "\n");
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("Search Benchmark", () => {
  let tempDir: string;
  let system: MemorySystem;
  const queryResults: QueryResult[] = [];

  beforeAll(async () => {
    tempDir = await createTempDir();
    system = createMemorySystem({
      baseDir: tempDir,
      sqlitePath: join(tempDir, ".index", "search.sqlite"),
    });
    await system.start();

    // Index corpus with real embeddings
    const now = Date.now();
    for (const doc of CORPUS) {
      const embedding = await system.embedding.embed(doc.content);
      await system.searchIndex.index({
        metadata: {
          id: doc.id,
          title: doc.title,
          type: doc.type,
          tags: doc.tags,
          importance: "medium" as const,
          createdAt: now,
          updatedAt: now,
          lastAccessedAt: now,
          source: "benchmark",
        },
        content: doc.content,
        filePath: join(tempDir, `${doc.id}.md`),
        embedding: embedding.vector,
      } as any);
    }

    // Run all queries
    for (const q of QUERIES) {
      const queryEmbed = await system.embedding.embed(q.query);
      let vectorFallback = false;

      let results;
      try {
        results = await system.searchIndex.searchHybrid(
          q.query,
          queryEmbed.vector,
          { limit: 10, minScore: 0 },
        );
      } catch {
        // FTS5 can throw on special characters (/, ., etc.)
        results = await system.searchIndex.searchVector(
          queryEmbed.vector,
          10,
        );
        vectorFallback = true;
      }

      const returnedIds = results.map((r) => r.memory.metadata.id);
      const scores = results.map((r) => r.score);

      queryResults.push({
        query: q.query,
        description: q.description,
        category: q.category,
        expectedIds: q.expectedIds,
        returnedIds,
        scores,
        precisionAt3: precisionAtK(returnedIds, q.expectedIds, 3),
        mrr: reciprocalRank(returnedIds, q.expectedIds),
        scoreSpread: calcScoreSpread(scores),
        scoreMin: scores.length > 0 ? scores[scores.length - 1]! : 0,
        scoreMax: scores.length > 0 ? scores[0]! : 0,
        vectorFallback,
      });
    }

    // Print summary after all queries
    printSummary(queryResults);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    try {
      await system.stop();
    } catch {
      // may fail if already stopped
    }
    await cleanupTempDir(tempDir);
  }, TEST_TIMEOUT);

  // --- Aggregate metric tests ---

  test("Average Precision@3 meets baseline", () => {
    const avgP3 =
      queryResults.reduce((sum, r) => sum + r.precisionAt3, 0) /
      queryResults.length;
    // Baseline from first run: actual=0.813, floor=0.65
    expect(avgP3).toBeGreaterThanOrEqual(0.65);
  });

  test("Average MRR meets baseline", () => {
    const avgMRR =
      queryResults.reduce((sum, r) => sum + r.mrr, 0) / queryResults.length;
    // Baseline from first run: actual=0.841, floor=0.70
    expect(avgMRR).toBeGreaterThanOrEqual(0.70);
  });

  // --- Per-category tests ---

  test("Exact keyword: high precision and recall", () => {
    const cat = queryResults.filter((r) => r.category === "exact_keyword");
    const avgP3 =
      cat.reduce((s, r) => s + r.precisionAt3, 0) / cat.length;
    const avgMRR = cat.reduce((s, r) => s + r.mrr, 0) / cat.length;
    // First run: P@3=1.0, MRR=0.875
    expect(avgP3).toBeGreaterThanOrEqual(0.75);
    expect(avgMRR).toBeGreaterThanOrEqual(0.7);
  });

  test("German morphology: tracked (known weakness)", () => {
    const cat = queryResults.filter(
      (r) => r.category === "german_morphology",
    );
    const avgP3 =
      cat.reduce((s, r) => s + r.precisionAt3, 0) / cat.length;
    // First run: P@3=0.458 — known FTS weakness for German
    expect(avgP3).toBeGreaterThanOrEqual(0.3);
  });

  test("Compound words: tracked", () => {
    const cat = queryResults.filter((r) => r.category === "compound_word");
    const avgP3 =
      cat.reduce((s, r) => s + r.precisionAt3, 0) / cat.length;
    // First run: P@3=1.0 — embeddings handle compounds well
    expect(avgP3).toBeGreaterThanOrEqual(0.6);
  });

  test("Cross-language: multilingual embeddings handle this", () => {
    const cat = queryResults.filter((r) => r.category === "cross_language");
    const avgP3 =
      cat.reduce((s, r) => s + r.precisionAt3, 0) / cat.length;
    // First run: P@3=1.0 — multilingual model excels here
    expect(avgP3).toBeGreaterThanOrEqual(0.75);
  });

  test("Semantic similarity: pure meaning match", () => {
    const cat = queryResults.filter(
      (r) => r.category === "semantic_similarity",
    );
    const avgP3 =
      cat.reduce((s, r) => s + r.precisionAt3, 0) / cat.length;
    // First run: P@3=0.792
    expect(avgP3).toBeGreaterThanOrEqual(0.5);
  });

  test("Special chars: hyphenated and slashed terms", () => {
    const cat = queryResults.filter((r) => r.category === "special_chars");
    const avgMRR = cat.reduce((s, r) => s + r.mrr, 0) / cat.length;
    // First run: MRR=0.786 — most fall back to vector-only
    expect(avgMRR).toBeGreaterThanOrEqual(0.5);
  });

  test("Score spread is meaningful across queries", () => {
    const spreads = queryResults
      .filter((r) => r.scores.length >= 2)
      .map((r) => r.scoreSpread);
    const avgSpread =
      spreads.reduce((s, v) => s + v, 0) / spreads.length;
    expect(avgSpread).toBeGreaterThan(0.01);
  });
});
