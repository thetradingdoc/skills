/**
 * AES-256-GCM encryption for sensitive tokens (e.g. Jira API token).
 * Key resolution order:
 * 1. ENCRYPTION_KEY env var (64-char hex)
 * 2. .encryption-key file next to server (auto-generated on first use)
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KEY_FILE = path.resolve(__dirname, "../../.encryption-key");
const ALGO = "aes-256-gcm";
let cachedKey = null;
function getOrCreateKey() {
    const envHex = process.env.ENCRYPTION_KEY?.trim();
    if (envHex && envHex.length === 64 && /^[0-9a-fA-F]+$/.test(envHex)) {
        return envHex;
    }
    if (fs.existsSync(KEY_FILE)) {
        const hex = fs.readFileSync(KEY_FILE, "utf8").trim();
        if (hex.length === 64 && /^[0-9a-fA-F]+$/.test(hex))
            return hex;
    }
    const hex = crypto.randomBytes(32).toString("hex");
    try {
        fs.writeFileSync(KEY_FILE, hex, { mode: 0o600 });
    }
    catch (e) {
        throw new Error("No ENCRYPTION_KEY in env and could not create .encryption-key file. " +
            "Set ENCRYPTION_KEY in .env or ensure webapp/server/ is writable.");
    }
    return hex;
}
function getKey() {
    if (cachedKey)
        return cachedKey;
    const hex = getOrCreateKey();
    cachedKey = Buffer.from(hex, "hex");
    return cachedKey;
}
export function encrypt(text) {
    const key = getKey();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGO, key, iv);
    const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}
export function decrypt(stored) {
    const key = getKey();
    const parts = stored.split(":");
    if (parts.length !== 3) {
        throw new Error("Invalid encrypted format");
    }
    const [ivHex, tagHex, encHex] = parts;
    const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return (decipher.update(Buffer.from(encHex, "hex")).toString("utf8") +
        decipher.final("utf8"));
}
