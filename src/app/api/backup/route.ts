import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { readOrMigrateDataFile, writeDataFile } from "@/lib/github";
import { writeLocalData } from "@/lib/localdb";
import type { AppData } from "@/lib/github";

function isGitHubConfigured(): boolean {
  return !!(
    process.env.GITHUB_TOKEN &&
    process.env.GITHUB_REPO_OWNER &&
    process.env.GITHUB_REPO_NAME
  );
}

// GET /api/backup — restore from GitHub into local DB
export async function GET() {
  const session = await auth();
  if (!session?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.error === "RefreshTokenError") {
    return NextResponse.json({ error: "Session expired — please sign in again" }, { status: 401 });
  }
  if (!isGitHubConfigured()) {
    return NextResponse.json({ error: "GitHub backup not configured" }, { status: 503 });
  }

  try {
    const { data } = await readOrMigrateDataFile(session.userId);
    if (!data) {
      return NextResponse.json({ error: "No GitHub backup found" }, { status: 404 });
    }
    await writeLocalData(session.userId, data);
    return NextResponse.json({
      ok: true,
      counts: {
        customers: data.customers.length,
        products:  data.products.length,
        sales:     data.sales.length,
        payments:  data.payments.length,
        debts:     data.debts.length,
      },
    });
  } catch (e) {
    console.error("[backup] GET error:", e);
    return NextResponse.json({ error: "Restore failed" }, { status: 500 });
  }
}

// POST /api/backup — push current data to GitHub
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.error === "RefreshTokenError") {
    return NextResponse.json({ error: "Session expired — please sign in again" }, { status: 401 });
  }
  if (!isGitHubConfigured()) {
    return NextResponse.json({ error: "GitHub backup not configured" }, { status: 503 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const data: AppData = {
    customers: Array.isArray(body.customers) ? body.customers as AppData["customers"] : [],
    products:  Array.isArray(body.products)  ? body.products  as AppData["products"]  : [],
    sales:     Array.isArray(body.sales)     ? body.sales     as AppData["sales"]     : [],
    payments:  Array.isArray(body.payments)  ? body.payments  as AppData["payments"]  : [],
    debts:     Array.isArray(body.debts)     ? body.debts     as AppData["debts"]     : [],
  };

  const sha = typeof body.sha === "string" ? body.sha : null;

  try {
    const newSha = await writeDataFile(session.userId, data, sha);
    if (!newSha) {
      return NextResponse.json({ error: "GitHub write failed" }, { status: 502 });
    }
    return NextResponse.json({ ok: true, sha: newSha });
  } catch (e) {
    console.error("[backup] POST error:", e);
    return NextResponse.json({ error: "Backup failed" }, { status: 500 });
  }
}
