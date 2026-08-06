/**
 * Split a long text into overlapping chunks for RAG retrieval.
 *
 * The algorithm tries to break at sentence or paragraph boundaries so each
 * chunk stays semantically coherent. A `chunkSize` cap keeps individual
 * chunks small enough for embedding models; `overlap` ensures the retrieval
 * index doesn't lose context near the boundaries between consecutive chunks.
 *
 * The maximum chunk count is capped at 50 so a single document cannot
 * create an unbounded number of rows (each chunk becomes a `DocumentChunk`
 * row). If a document is longer than 50 * (chunkSize - overlap) chars, the
 * tail is silently dropped — callers should surface that in their UI.
 */
export function splitIntoChunks(text: string, chunkSize: number, overlap: number): string[] {
  if (text.length <= chunkSize) return [text];

  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    let chunk = text.slice(start, end);

    // Try to break at a sentence or word boundary
    if (end < text.length) {
      const lastPeriod = chunk.lastIndexOf(". ");
      const lastNewline = chunk.lastIndexOf("\n");
      const breakPoint = Math.max(lastPeriod, lastNewline);
      if (breakPoint > chunkSize * 0.5) {
        chunk = text.slice(start, start + breakPoint + 1);
        start = start + breakPoint + 1 - overlap;
      } else {
        start = end - overlap;
      }
    } else {
      start = end;
    }

    chunks.push(chunk.trim());
    if (chunks.length >= 50) break; // cap at 50 chunks
  }

  return chunks.filter((c) => c.length > 0);
}