import { generateSecret, generateURI, verify } from "otplib";
import { randomBytes } from "crypto";

export function generateTotpSecret() {
  return generateSecret();
}

export function getTotpUri(
  email: string,
  secret: string,
  issuer = "Danets Platform Admin"
) {
  return generateURI({
    issuer,
    label: email,
    secret,
  });
}

export async function verifyTotpCode(secret: string, code: string) {
  const result = await verify({
    token: code.replace(/\s/g, ""),
    secret,
  });
  return result.valid;
}

export function generateBackupCodes(count = 8) {
  return Array.from({ length: count }, () =>
    randomBytes(4).toString("hex").toUpperCase()
  );
}
