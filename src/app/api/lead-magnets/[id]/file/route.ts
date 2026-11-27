import { NextRequest, NextResponse } from "next/server";
import { withSession } from "@/lib/api";
import { AppError } from "@/lib/app-error";
import { getSession } from "@/lib/auth";
import { isModuleEnabled } from "@/lib/module-access";
import { getMagnet, magnetFile, toMagnetDto, uploadMagnetFile, MAX_MAGNET_BYTES } from "@/lib/magnets/service";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/lead-magnets/<id>/file: preview the PDF (signed-in staff only).
export async function GET(_req: NextRequest, { params }: Ctx) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await isModuleEnabled(user.businessId, "leads"))) return NextResponse.json({ error: "Not available on your plan." }, { status: 403 });
  const { id } = await params;
  const m = await getMagnet(user.businessId, id).catch(() => null);
  const file = m ? await magnetFile(m) : null;
  if (!m || !file) return NextResponse.json({ error: "No file yet." }, { status: 404 });
  if ("redirect" in file) return NextResponse.redirect(file.redirect);
  return new NextResponse(new Uint8Array(file.body), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${m.fileName ?? "download.pdf"}"`,
      "Content-Length": String(file.body.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

// POST /api/lead-magnets/<id>/file (multipart "file"): upload the PDF.
export async function POST(req: NextRequest, { params }: Ctx) {
  return withSession(async (user) => {
    if (user.role !== "admin" && user.role !== "owner") throw new Error("FORBIDDEN");
    const { id } = await params;
    const len = Number(req.headers.get("content-length") ?? 0);
    if (len > MAX_MAGNET_BYTES + 64 * 1024) throw new AppError("PDFs can be up to 10 MB.", { status: 413, code: "FILE_TOO_LARGE" });
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new AppError("Send the file as multipart/form-data.", { status: 400, code: "INVALID_BODY" });
    }
    const file = form.get("file");
    if (!file || typeof file === "string") throw new AppError("No file was attached.", { status: 400, code: "NO_FILE" });
    const m = await uploadMagnetFile(user.businessId, id, Buffer.from(await file.arrayBuffer()), file.name);
    return { magnet: toMagnetDto(m) };
  });
}
