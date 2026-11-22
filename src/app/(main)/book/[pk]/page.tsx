import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Clock, MapPin } from "lucide-react";
import { loadBookingBusiness } from "@/lib/booking/page-data";

type Props = { params: Promise<{ pk: string }> };

export async function generateMetadata({ params }: Props) {
  const { pk } = await params;
  const data = await loadBookingBusiness(pk);
  return { title: data ? `Book a time with ${data.name}` : "Booking" };
}

// /book/<pk>: every bookable meeting type of a business (straight to the
// type when there's only one).
export default async function BookingIndexPage({ params }: Props) {
  const { pk } = await params;
  const data = await loadBookingBusiness(pk);
  if (!data || data.types.length === 0) notFound();
  if (data.types.length === 1) redirect(`/book/${encodeURIComponent(pk)}/${data.types[0].slug}`);

  return (
    <div className="rounded-2xl border bg-background p-6 sm:p-8 shadow-sm space-y-6">
      <div>
        <div className="text-sm text-muted-foreground">{data.name}</div>
        <h1 className="text-2xl font-bold tracking-tight">Book a time</h1>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {data.types.map((t) => (
          <li key={t.slug}>
            <Link href={`/book/${encodeURIComponent(pk)}/${t.slug}`} className="block rounded-xl border p-4 hover:border-primary hover:bg-primary/5 transition-colors">
              <div className="font-medium">{t.name}</div>
              <div className="mt-1 flex gap-4 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" aria-hidden /> {t.durationMin} min
                </span>
                <span className="flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" aria-hidden /> {t.locationLabel}
                </span>
              </div>
              {t.description && <p className="mt-2 text-sm text-muted-foreground line-clamp-2">{t.description}</p>}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
