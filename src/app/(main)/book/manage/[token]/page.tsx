import { ManageBooking } from "@/components/booking/manage-booking";

export const metadata = { title: "Your booking" };

// /book/manage/<token>: the link in every booking email.
export default async function ManageBookingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ManageBooking token={token} />;
}
