import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { readOrMigrateDataFile, writeDataFile, AppData } from "@/lib/github";

export async function GET() {
  const session = await auth();
  if (!session?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { data, sha } = await readOrMigrateDataFile(session.userId);
    if (!data) {
      return NextResponse.json({
        customers: [],
        products: [],
        sales: [],
        payments: [],
        debts: [],
        sha: null,
      });
    }
    return NextResponse.json({ ...data, sha });
  } catch (e) {
    console.error("GitHub read error:", e);
    return NextResponse.json({ error: "Read failed" }, { status: 500 });
  }
}

function isArray(v: unknown): v is unknown[] {
  return Array.isArray(v);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (
    !isArray(body.customers) ||
    !isArray(body.products) ||
    !isArray(body.sales) ||
    !isArray(body.payments) ||
    !isArray(body.debts)
  ) {
    return NextResponse.json({ error: "Invalid payload: all data fields must be arrays" }, { status: 400 });
  }

  try {
    const data: AppData = {
      customers: body.customers as AppData["customers"],
      products:  body.products  as AppData["products"],
      sales:     body.sales     as AppData["sales"],
      payments:  body.payments  as AppData["payments"],
      debts:     body.debts     as AppData["debts"],
    };
    const sha = typeof body.sha === "string" ? body.sha : null;

    const newSha = await writeDataFile(session.userId, data, sha);
    if (newSha === null) {
      return NextResponse.json({ error: "Sync failed: write returned no SHA" }, { status: 502 });
    }
    return NextResponse.json({ ok: true, sha: newSha });
  } catch (e) {
    console.error("GitHub write error:", e);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
