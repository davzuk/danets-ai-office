import { generateSecret, generateURI, verify } from "otplib";
import { randomBytes } from "crypto";

export function generateTotpSecret() {
  return generateSecret();
}

export function getTotpUri(email: string, secret: string) {
  return generateURI({
    issuer: "Danets Platform Admin",
    label: email,
    secret,
  });
}

export async function verifyTotpCode(secret: string, code: string) {
  const result = await verify({
    token: code.replace(/\s/g, ""),
    secret,
    window: 1,
  });
  return result.valid;
}

export function generateBackupCodes(count = 8) {
  return Array.from({ length: count }, () =>
    randomBytes(4).toString("hex").toUpperCase()
  );
}
