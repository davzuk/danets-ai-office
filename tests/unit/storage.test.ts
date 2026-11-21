import { describe, expect, it } from "vitest";
import { isSafeKey, localPath, s3Driver, signV4, uriEncode } from "@/lib/storage";

describe("signV4", () => {
  it("matches AWS's documented S3 GET Object example", () => {
    // https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html (Example: GET Object)
    const headers = signV4({
      method: "GET",
      url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"),
      headers: { Range: "bytes=0-9" },
      payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      region: "us-east-1",
      now: new Date("2013-05-24T00:00:00Z"),
    });
    expect(headers.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"
    );
  });
});

describe("storage keys", () => {
  it("accepts generated keys and rejects traversal", () => {
    expect(isSafeKey("cbiz123/2026/11/cm9x1y2z.jpg")).toBe(true);
    expect(isSafeKey("../etc/passwd")).toBe(false);
    expect(isSafeKey("a/../b.jpg")).toBe(false);
    expect(isSafeKey("a/b c.jpg")).toBe(false);
    expect(isSafeKey("/abs/x.jpg")).toBe(false);
    expect(() => localPath("..\\x.jpg", { STORAGE_LOCAL_DIR: "/tmp/media" })).toThrow();
    expect(() => localPath("../x.jpg", { STORAGE_LOCAL_DIR: "/tmp/media" })).toThrow();
  });

  it("encodes like SigV4 expects", () => {
    expect(uriEncode("a b/c*(d)")).toBe("a%20b/c%2A%28d%29");
    expect(uriEncode("a/b", false)).toBe("a%2Fb");
  });

  it("builds public S3 URLs from S3_PUBLIC_URL", () => {
    const d = s3Driver({
      S3_ENDPOINT: "https://acct.r2.cloudflarestorage.com",
      S3_BUCKET: "media",
      S3_ACCESS_KEY_ID: "k",
      S3_SECRET_ACCESS_KEY: "s",
      S3_PUBLIC_URL: "https://media.example.com/",
    });
    expect(d.publicUrl("b1/2026/11/x.jpg")).toBe("https://media.example.com/b1/2026/11/x.jpg");
    expect(() => s3Driver({ S3_BUCKET: "x" })).toThrow(/S3_ENDPOINT/);
  });
});
