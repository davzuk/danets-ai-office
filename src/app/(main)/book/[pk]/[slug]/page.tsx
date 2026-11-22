import { notFound } from "next/navigation";
import { BookingFlow, BookingSummary } from "@/components/booking/booking-flow";
import { CalendlyEmbed } from "@/components/booking/calendly-embed";
import { loadBookingBusiness } from "@/lib/booking/page-data";

type Props = {
  params: Promise<{ pk: string; slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props) {
  const { pk, slug } = await params;
  const data = await loadBookingBusiness(pk);
  const type = data?.types.find((t) => t.slug === slug);
  return { title: type && data ? `${type.name} · ${data.name}` : "Booking" };
}

// /book/<pk>/<slug>: the hosted booking page for one meeting type.
// ?name=&email= prefill the form (the widget and emails link here).
export default async function BookingTypePage({ params, searchParams }: Props) {
  const { pk, slug } = await params;
  const sp = await searchParams;
  const data = await loadBookingBusiness(pk);
  const type = data?.types.find((t) => t.slug === slug);
  if (!data || !type) notFound();
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v.slice(0, 191) : undefined);

  return (
    <div className="rounded-2xl border bg-background shadow-sm grid md:grid-cols-[280px_1fr]">
      <div className="p-6 sm:p-8 border-b md:border-b-0 md:border-r">
        <BookingSummary businessName={data.name} type={type} />
        {data.types.length > 1 && (
          <a href={`/book/${encodeURIComponent(pk)}`} className="mt-6 inline-block text-sm text-primary hover:underline">
            ← Other meeting types
          </a>
        )}
      </div>
      <div className="p-6 sm:p-8">
        {type.provider === "calendly" && type.calendlyUrl ? (
          <CalendlyEmbed url={type.calendlyUrl} title={type.name} prefill={{ name: one(sp.name), email: one(sp.email) }} />
        ) : (
          <BookingFlow pk={pk} businessName={data.name} type={type} prefill={{ name: one(sp.name), email: one(sp.email) }} />
        )}
      </div>
    </div>
  );
}
