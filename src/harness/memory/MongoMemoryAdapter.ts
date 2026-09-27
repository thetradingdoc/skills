import { createHash } from "node:crypto";
import { MongoClient, Db, ObjectId } from "mongodb";
import type {
  MemoryAdapter,
  MemoryRecord,
  RunLogEntry,
  ConfigVersion,
} from "./MemoryAdapter";

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMS = 1536;

async function embed(text: string, apiKey: string): Promise<number[]> {
  const OpenAI = (await import("openai")).default;
  const client = new OpenAI({ apiKey });
  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text.slice(0, 8000),
  }) as unknown as { data: Array<{ embedding: number[] }> };
  const vec = response.data?.[0]?.embedding;
  if (!vec || vec.length !== EMBEDDING_DIMS) {
    throw new Error("Embedding failed or returned unexpected dimensions.");
  }
  return vec;
}

async function embedMany(texts: string[], apiKey: string): Promise<number[][]> {
  const OpenAI = (await import("openai")).default;
  const client = new OpenAI({ apiKey });
  const response = await client.embeddings.create({ model: EMBEDDING_MODEL, input: texts }) as unknown as { data: Array<{ index: number; embedding: number[] }> };
  const vectors = [...response.data].sort((a, b) => a.index - b.index).map((row) => row.embedding);
  if (vectors.length !== texts.length || vectors.some((vector) => vector.length !== EMBEDDING_DIMS)) {
    throw new Error("Embedding batch failed or returned unexpected dimensions.");
  }
  return vectors;
}

export class MongoMemoryAdapter implements MemoryAdapter {
  private client: MongoClient;
  private dbPromise: Promise<Db> | null = null;
  private openaiApiKey: string;
  private vectorIndexName: string;
  private dbName: string;
  private collectionName: string;

  constructor(params: {
    uri: string;
    dbName?: string;
    openaiApiKey?: string;
    vectorIndexName?: string;
  }) {
    const key = params.openaiApiKey ?? process.env.OPENAI_API_KEY?.trim();
    if (!key) {
      throw new Error(
        "MongoMemoryAdapter requires an OpenAI API key for embeddings (OPENAI_API_KEY)."
      );
    }
    this.openaiApiKey = key;
    this.vectorIndexName = params.vectorIndexName ?? (process.env.MONGODB_VECTOR_INDEX?.trim() || "agent_memory_vector_index");
    this.dbName = params.dbName ?? process.env.MONGODB_DATABASE?.trim() ?? "skills_harness";
    this.collectionName = process.env.MONGODB_MEMORY_COLLECTION?.trim() || "agent_memory";
    this.client = new MongoClient(params.uri, { serverSelectionTimeoutMS: 8000, connectTimeoutMS: 8000 });
  }

  private async db(): Promise<Db> {
    this.dbPromise ??= this.client.connect().then((client) => client.db(this.dbName));
    return this.dbPromise;
  }

  async remember(record: MemoryRecord): Promise<{ id: string }> {
    const db = await this.db();
    const text = record.text.slice(0, 4000);
    const embedding = await embed(text, this.openaiApiKey);
    const result = await db.collection(this.collectionName).insertOne({
      agentId: record.agentId,
      text,
      metadata: record.metadata ?? {},
      salience: record.salience ?? 1,
      embedding,
      createdAt: record.createdAt ?? new Date(),
    });
    return { id: result.insertedId.toString() };
  }

  /** Index a bounded text document as overlapping chunks scoped to one harness identity. */
  async indexText(params: { agentId: string; source: string; text: string }): Promise<{ chunksIndexed: number }> {
    const source = params.source.trim().slice(0, 300);
    const text = params.text.slice(0, 100_000);
    if (!source || !text.trim()) throw new Error("A document source and non-empty text are required.");
    const chunkSize = 1600;
    const overlap = 160;
    const chunks: string[] = [];
    for (let start = 0; start < text.length && chunks.length < 80; start += chunkSize - overlap) {
      const chunk = text.slice(start, start + chunkSize).trim();
      if (chunk) chunks.push(chunk);
    }
    if (!chunks.length) return { chunksIndexed: 0 };
    const embeddings = await embedMany(chunks, this.openaiApiKey);
    const db = await this.db();
    const collection = db.collection<{ _id: string | ObjectId; [key: string]: unknown }>(this.collectionName);
    const operations = chunks.map((chunk, index) => ({
      updateOne: {
        filter: { _id: createHash("sha256").update(`${params.agentId}\0${source}\0${index}`).digest("hex") },
        update: { $set: { agentId: params.agentId, text: chunk, metadata: { source, chunkIndex: index }, source, chunkIndex: index, salience: 1, embedding: embeddings[index], createdAt: new Date() } },
        upsert: true,
      },
    }));
    await collection.bulkWrite(operations);
    await collection.deleteMany({ agentId: params.agentId, source, chunkIndex: { $gte: chunks.length } });
    return { chunksIndexed: chunks.length };
  }

  async recall(params: {
    agentId: string;
    query: string;
    k?: number;
  }): Promise<MemoryRecord[]> {
    const db = await this.db();
    const queryVector = await embed(params.query, this.openaiApiKey);
    const k = Math.max(1, Math.min(8, Math.floor(params.k ?? 5)));

    const pipeline = [
      {
        $vectorSearch: {
          index: this.vectorIndexName,
          path: "embedding",
          queryVector,
          numCandidates: Math.max(50, k * 10),
          limit: k,
          filter: { agentId: { $eq: params.agentId } },
        },
      },
      {
        $project: {
          text: 1,
          metadata: 1,
          salience: 1,
          agentId: 1,
          createdAt: 1,
          score: { $meta: "vectorSearchScore" },
        },
      },
    ];

    const docs = await db.collection(this.collectionName).aggregate(pipeline).toArray();
    return docs.map((d: any) => ({
      id: d._id.toString(),
      agentId: d.agentId,
      text: d.text,
      metadata: d.metadata,
      salience: d.salience,
      createdAt: d.createdAt,
    }));
  }

  async logRun(entry: RunLogEntry): Promise<{ id: string }> {
    const db = await this.db();
    const result = await db.collection("harness_runs").insertOne({
      ...entry,
      createdAt: entry.createdAt ?? new Date(),
    });
    return { id: result.insertedId.toString() };
  }

  async getRecentRuns(params: {
    agentId: string;
    limit?: number;
  }): Promise<RunLogEntry[]> {
    const db = await this.db();
    const docs = await db
      .collection("harness_runs")
      .find({ agentId: params.agentId })
      .sort({ createdAt: -1 })
      .limit(params.limit ?? 20)
      .toArray();
    return docs as unknown as RunLogEntry[];
  }

  async proposeConfigChange(
    version: Omit<ConfigVersion, "status" | "id">
  ): Promise<{ id: string }> {
    const db = await this.db();
    const result = await db.collection("harness_config_versions").insertOne({
      ...version,
      status: "proposed",
      createdAt: version.createdAt ?? new Date(),
    });
    return { id: result.insertedId.toString() };
  }

  async approveConfigChange(id: string, approvedBy: string): Promise<void> {
    const db = await this.db();
    await db.collection("harness_config_versions").updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: "applied", approvedBy, appliedAt: new Date() } }
    );
  }

  async getVersionHistory(nodeId: string): Promise<ConfigVersion[]> {
    const db = await this.db();
    const docs = await db
      .collection("harness_config_versions")
      .find({ nodeId })
      .sort({ createdAt: -1 })
      .toArray();
    return docs.map((d: any) => ({ ...d, id: d._id.toString() }));
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
