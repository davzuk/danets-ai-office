import { NextRequest, NextResponse } from "next/server";
import { pdf } from "@react-pdf/renderer";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";
import { InvoicePDF, type InvoicePdfItem } from "@/components/dashboard/views/invoice-pdf";

export const runtime = "nodejs";

// GET /api/invoices/[id]/pdf — stream a PDF copy of the invoice
export function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withSession(async (user) => {
    const { id } = await params;
    if (!id) throw new Error("Invoice id is required");

    const invoice = await db.invoice.findFirst({
      where: { id, businessId: user.businessId },
      include: {
        payment: {
          select: { payerName: true, payerEmail: true, reference: true },
        },
        business: {
          select: { name: true, email: true, phone: true },
        },
      },
    });

    if (!invoice) throw new Error("Invoice not found");

    let items: InvoicePdfItem[] = [];
    try {
      const parsed = invoice.items ? JSON.parse(invoice.items) : [];
      items = Array.isArray(parsed) ? parsed : [];
    } catch {
      items = [];
    }

    // @react-pdf/renderer v4 returns a ReadableStream from toBuffer() — drain
    // it into a single Uint8Array so NextResponse can serve it as a binary PDF.
    const stream = await pdf(
      InvoicePDF({
        invoice: {
          invoiceNumber: invoice.invoiceNumber,
          amount: invoice.amount,
          currency: invoice.currency,
          status: invoice.status,
          dueDate: invoice.dueDate?.toISOString() ?? null,
          paidAt: invoice.paidAt?.toISOString() ?? null,
          notes: invoice.notes,
          createdAt: invoice.createdAt.toISOString(),
        },
        business: {
          name: invoice.business?.name ?? user.businessName,
          email: invoice.business?.email ?? null,
          phone: invoice.business?.phone ?? null,
        },
        items,
        customerName: invoice.payment?.payerName ?? null,
        customerEmail: invoice.payment?.payerEmail ?? null,
      })
    ).toBuffer();

    const chunks: Buffer[] = [];
    for await (const chunk of stream as unknown as AsyncIterable<Buffer>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const body = Buffer.concat(chunks);

    const filename = `${invoice.invoiceNumber}.pdf`;

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": body.byteLength.toString(),
        "Cache-Control": "private, no-store",
      },
    });
  });
}
