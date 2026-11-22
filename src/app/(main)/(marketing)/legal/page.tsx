// Auto-redirect — visitors who land on /legal are sent to the terms page.
import { redirect } from "next/navigation";

export default function LegalIndex() {
  redirect("/legal/terms");
}
