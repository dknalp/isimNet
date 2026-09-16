import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { readLocalData, writeLocalData } from "@/lib/localdb";
import type { AppData } from "@/lib/github";

export async function GET() {
  const session = await auth();
  if (!session?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const raw = await readLocalData(session.userId);
    // Normalize: default non-array fields to [] to guard against schema drift or corrupt files
    const data = {
      customers: Array.isArray(raw?.customers) ? raw.customers : [],
      products:  Array.isArray(raw?.products)  ? raw.products  : [],
      sales:     Array.isArray(raw?.sales)     ? raw.sales     : [],
      payments:  Array.isArray(raw?.payments)  ? raw.payments  : [],
      debts:     Array.isArray(raw?.debts)     ? raw.debts     : [],
    };
    return NextResponse.json(data);
  } catch (e) {
    console.error("[sync] GET error:", e);
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

    await writeLocalData(session.userId, data);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[sync] POST error:", e);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
