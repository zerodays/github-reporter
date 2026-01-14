import { NextResponse } from "next/server";
import { getObjectText } from "@/lib/storage";

export async function GET(
  _request: Request,
  context: { params: Promise<{ path: string[] }> }
) {
  const { path } = await context.params;
  const key = path.join("/");
  try {
    const body = await getObjectText(key);
    if (body === null) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const contentType = key.endsWith(".json")
      ? "application/json; charset=utf-8"
      : "text/plain; charset=utf-8";
    return new NextResponse(body, { headers: { "content-type": contentType } });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
