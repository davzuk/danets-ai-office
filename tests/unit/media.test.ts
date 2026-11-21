import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";

vi.mock("@/lib/db", () => ({ db: {} }));

const { MEDIA_LIMITS, processImage, sniffMedia } = await import("@/lib/media");

const pad = (head: number[] | string, len = 16) => {
  const b = Buffer.alloc(len);
  (typeof head === "string" ? Buffer.from(head, "latin1") : Buffer.from(head)).copy(b);
  return b;
};
const ftyp = (brand: string) => pad(`\0\0\0\x18ftyp${brand}`);

describe("sniffMedia", () => {
  it("recognises the accepted formats by their bytes", () => {
    expect(sniffMedia(pad([0xff, 0xd8, 0xff, 0xe0]))?.mime).toBe("image/jpeg");
    expect(sniffMedia(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))?.mime).toBe("image/png");
    expect(sniffMedia(pad("RIFF\0\0\0\0WEBP"))?.mime).toBe("image/webp");
    expect(sniffMedia(pad("GIF89a"))?.mime).toBe("image/gif");
    expect(sniffMedia(ftyp("isom"))).toEqual({ mime: "video/mp4", ext: "mp4", kind: "video" });
    expect(sniffMedia(ftyp("qt  "))?.ext).toBe("mov");
    expect(sniffMedia(pad([0x1a, 0x45, 0xdf, 0xa3]))?.mime).toBe("video/webm");
  });

  it("rejects HEIC/AVIF, SVG, HTML and tiny files", () => {
    expect(sniffMedia(ftyp("heic"))).toBeNull();
    expect(sniffMedia(ftyp("avif"))).toBeNull();
    expect(sniffMedia(pad('<svg xmlns="http://www.w3.org/2000/svg">', 48))).toBeNull();
    expect(sniffMedia(pad("<!doctype html><script>", 32))).toBeNull();
    expect(sniffMedia(Buffer.from([0xff, 0xd8, 0xff]))).toBeNull();
  });
});

describe("processImage", () => {
  it("strips EXIF/GPS, applies orientation and caps the longest side", async () => {
    // 3000×1000 JPEG tagged "rotate 90°" (orientation 6) with EXIF.
    const input = await sharp({ create: { width: 3000, height: 1000, channels: 3, background: "#3366cc" } })
      .jpeg()
      .withMetadata({ orientation: 6, exif: { IFD0: { Copyright: "secret-owner" } } })
      .toBuffer();
    expect((await sharp(input).metadata()).exif).toBeDefined();

    const out = await processImage(input, "image/jpeg");
    const meta = await sharp(out.body).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    expect(out.body.includes(Buffer.from("secret-owner"))).toBe(false);
    // Rotated to portrait, then fitted inside 2048.
    expect(out.width).toBe(Math.round((1000 * MEDIA_LIMITS.maxImageSide) / 3000));
    expect(out.height).toBe(MEDIA_LIMITS.maxImageSide);
    expect(meta.format).toBe("jpeg");
  });

  it("doesn't enlarge small images and keeps the format", async () => {
    const png = await sharp({ create: { width: 40, height: 30, channels: 4, background: "#ff000080" } }).png().toBuffer();
    const out = await processImage(png, "image/png");
    expect([out.width, out.height]).toEqual([40, 30]);
    expect((await sharp(out.body).metadata()).format).toBe("png");
  });

  it("throws on damaged images", async () => {
    await expect(processImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]), "image/jpeg")).rejects.toThrow();
  });
});
