import { Customer, Sale, Payment, Debt } from "./customers";
import { Product } from "./products";

const BASE = "https://api.github.com";
const owner = process.env.GITHUB_REPO_OWNER!;
const repo = process.env.GITHUB_REPO_NAME!;
const branch = process.env.GITHUB_BRANCH ?? "main";
const token = process.env.GITHUB_TOKEN!;

export interface AppData {
  customers: Customer[];
  products: Product[];
  sales: Sale[];
  payments: Payment[];
  debts: Debt[];
}

function dataPath(userId: string) {
  return `users/${userId}/data.json`;
}

// Legacy ayrı dosyalar — migration için
function legacyPath(userId: string, fileName: string) {
  return `users/${userId}/${fileName}`;
}

async function ghGet(path: string) {
  return fetch(`${BASE}/repos/${owner}/${repo}/contents/${path}?ref=${branch}`, {
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github+json",
    },
    cache: "no-store",
  });
}

export async function readDataFile(
  userId: string
): Promise<{ data: AppData | null; sha: string | null }> {
  const res = await ghGet(dataPath(userId));
  if (res.status === 404) return { data: null, sha: null };
  if (!res.ok) return { data: null, sha: null };
  let json: Record<string, unknown>;
  try {
    json = await res.json();
  } catch {
    console.error(`readDataFile: response.json() failed for user ${userId}`);
    return { data: null, sha: null };
  }
  if (!json.content) {
    console.error(`readDataFile: missing content field for user ${userId}`);
    return { data: null, sha: null };
  }
  try {
    const data: AppData = JSON.parse(
      Buffer.from(json.content as string, "base64").toString("utf-8")
    );
    return { data, sha: (json.sha as string) ?? null };
  } catch (err) {
    console.error(`readDataFile: corrupt content for user ${userId}`, err);
    return { data: null, sha: null };
  }
}

// Eski ayrı dosyalardan okur — yalnızca migration için
async function readLegacyFiles(userId: string): Promise<AppData | null> {
  const files = ["customers", "products", "sales", "payments", "debts"] as const;
  const results = await Promise.all(
    files.map(async (f) => {
      const res = await ghGet(legacyPath(userId, `${f}.json`));
      if (!res.ok) return [];
      const json = await res.json();
      try {
        return JSON.parse(Buffer.from(json.content as string, "base64").toString("utf-8"));
      } catch {
        return [];
      }
    })
  );
  const [customers, products, sales, payments, debts] = results;
  if (!customers.length && !products.length) return null;
  return { customers, products, sales, payments, debts };
}

async function attemptWrite(
  userId: string,
  data: AppData,
  sha: string | null
): Promise<string | "CONFLICT" | null> {
  const path = dataPath(userId);
  const content = Buffer.from(JSON.stringify(data)).toString("base64");
  const body: Record<string, unknown> = {
    message: "sync: update data",
    content,
    branch,
  };
  if (sha) body.sha = sha;

  const res = await fetch(`${BASE}/repos/${owner}/${repo}/contents/${path}`, {
    method: "PUT",
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (res.status === 409) return "CONFLICT";
  // 422 = "file already exists but no sha provided" — treat like a conflict
  if (res.status === 422) return "CONFLICT";
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    console.error(`writeDataFile failed [${res.status}]: ${path}`, err);
    return null;
  }
  let json: Record<string, unknown>;
  try {
    json = await res.json();
  } catch {
    console.error(`attemptWrite: response.json() failed for user ${userId}`);
    return null;
  }
  return ((json.content as Record<string, unknown>)?.sha as string) ?? null;
}

export async function writeDataFile(
  userId: string,
  data: AppData,
  sha: string | null
): Promise<string | null> {
  const result = await attemptWrite(userId, data, sha);
  if (result !== "CONFLICT") return result;

  // 409 → taze SHA alıp bir kez daha dene
  console.warn("writeDataFile: 409 conflict, retrying with fresh SHA");
  const fresh = await readDataFile(userId);

  // Dosya artık yok veya corrupt — SHA olmadan yaz
  const retryResult = await attemptWrite(userId, data, fresh.sha);
  if (retryResult === "CONFLICT") {
    console.error("writeDataFile: second conflict, giving up");
    return null;
  }
  return retryResult;
}

// data.json yoksa eski dosyalardan migrate et
export async function readOrMigrateDataFile(
  userId: string
): Promise<{ data: AppData | null; sha: string | null }> {
  const result = await readDataFile(userId);
  if (result.data !== null) return result;

  // data.json yok — eski dosyaları dene
  const legacy = await readLegacyFiles(userId);
  if (!legacy) return { data: null, sha: null };

  // Migration: eski veriyi data.json'a yaz
  console.info(`Migrating legacy files to data.json for user ${userId}`);
  const newSha = await writeDataFile(userId, legacy, null);
  return { data: legacy, sha: newSha };
}
