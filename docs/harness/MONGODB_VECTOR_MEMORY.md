# MongoDB Vector Memory for the Blanko Harness

The harness can use a MongoDB Atlas Vector Search collection for uploaded text and agent memory. The Mongo connection string and embedding key stay on the server; neither belongs in a saved canvas graph. Indexing sends the selected text to OpenAI's embeddings API and stores its chunks and vectors in the configured MongoDB collection, so the frontend must explain both destinations before a user indexes a file.

## Server configuration

Set these variables in the server environment:

```text
MONGODB_URI=mongodb+srv://…
MONGODB_DATABASE=skills_harness
MONGODB_MEMORY_COLLECTION=agent_memory
MONGODB_VECTOR_INDEX=agent_memory_vector_index
OPENAI_API_KEY=…
```

`MONGODB_DATABASE`, `MONGODB_MEMORY_COLLECTION`, and `MONGODB_VECTOR_INDEX` are optional. Their defaults are shown above. The current adapter creates 1536-dimensional vectors with `text-embedding-3-small`, so the Atlas index must use the same dimension and cosine similarity.

## Atlas Vector Search index

Create a Vector Search index named `agent_memory_vector_index` on the `agent_memory` collection with this definition:

```json
{
  "fields": [
    {
      "type": "vector",
      "path": "embedding",
      "numDimensions": 1536,
      "similarity": "cosine"
    },
    {
      "type": "filter",
      "path": "agentId"
    }
  ]
}
```

MongoDB Vector Search requires a Vector Search index on the embedding field and can pre-filter results using indexed fields. The harness uses `agentId` as that filter so searches stay scoped to a workspace and Agent block. See the [MongoDB Vector Search index guide](https://www.mongodb.com/docs/vector-search/indexes/vector-search-type/) and [vector search query stage](https://www.mongodb.com/docs/vector-search/query/aggregation-stages/vector-search-stage/?deployment-type=atlas&embedding=byo&interface=driver&language=nodejs).

## Current backend contract

- The canvas must contain a Blanko Agent block connected to a Vector DB block.
- `POST /api/workspaces/:workspaceId/harness/memory/index` accepts 1–10 named text documents, up to 200,000 characters per request. The server chunks and embeds them, then upserts them under a workspace-and-agent scope.
- During an agent run, `search_agent_memory` retrieves up to 8 matching chunks; `remember_agent_memory` saves a short, non-sensitive fact for later runs.
- Atlas connection failures and missing-index failures return actionable, redacted messages. API keys and MongoDB URIs are never returned to the client.
- The endpoint currently accepts text content. The frontend file picker and drag/drop flow will be added after the backend phase; binary file parsing is not part of this adapter.
