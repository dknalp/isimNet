import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { AppData } from "./github";

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");

function safeFilename(userId: string): string {
  return crypto.createHash("sha256").update(userId).digest("hex") + ".json";
}

function userPath(userId: string): string {
  return path.join(DATA_DIR, safeFilename(userId));
}

function isAppData(v: unknown): v is AppData {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return (
    Array.isArray(o.customers) &&
    Array.isArray(o.products) &&
    Array.isArray(o.sales) &&
    Array.isArray(o.payments) &&
    Array.isArray(o.debts)
  );
}

export async function readLocalData(userId: string): Promise<AppData | null> {
  try {
    const raw = await fs.readFile(userPath(userId), "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (!isAppData(parsed)) {
      console.error("[localdb] readLocalData: file is not valid AppData for user", userId);
      return null;
    }
    return parsed;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    console.error("[localdb] readLocalData: error for user", userId, e);
    return null;
  }
}

export async function writeLocalData(userId: string, data: AppData): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const target = userPath(userId);
  const tmp    = target + ".tmp." + crypto.randomBytes(8).toString("hex");
  await fs.writeFile(tmp, JSON.stringify(data), "utf-8");
  try {
    await fs.rename(tmp, target);
  } catch (renameErr) {
    // Clean up orphaned tmp file before re-throwing
    await fs.unlink(tmp).catch(() => {});
    throw renameErr;
  }
}
