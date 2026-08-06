import { describe, expect, it } from "vitest";
import { splitIntoChunks } from "@/lib/text-chunker";

describe("splitIntoChunks", () => {
  it("returns the text unchanged when shorter than chunkSize", () => {
    expect(splitIntoChunks("short text", 500, 100)).toEqual(["short text"]);
  });

  it("produces chunks no larger than chunkSize when no breakpoint found", () => {
    // No ". " or "\n" — falls back to hard slicing.
    const text = "a".repeat(1500);
    const chunks = splitIntoChunks(text, 500, 50);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(500);
    }
  });

  it("breaks at sentence boundaries when available", () => {
    // Need text long enough to actually go through the slice loop.
    const sentence = "This is a longer sentence with several words to pad it out. ";
    const text = sentence.repeat(8);
    const chunks = splitIntoChunks(text, 60, 10);
    expect(chunks.length).toBeGreaterThan(1);
    // Each pushed chunk is trimmed, so the first one should still contain a
    // sentence break (the algorithm chooses `start + breakPoint + 1`).
    expect(chunks[0]).toMatch(/\.\s*$/);
  });

  it("caps output at 50 chunks even for very long input", () => {
    const text = "x".repeat(100_000);
    const chunks = splitIntoChunks(text, 100, 10);
    expect(chunks.length).toBeLessThanOrEqual(50);
  });

  it("returns the original text unchanged on the short-input early-return path", () => {
    // The early return at the top of splitIntoChunks does not trim — callers
    // pass already-clean text in practice (POST /api/documents calls .trim()
    // before invoking the chunker).
    const text = "  hello world  ";
    const chunks = splitIntoChunks(text, 500, 0);
    expect(chunks).toEqual(["  hello world  "]);
  });
});