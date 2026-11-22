// Server-side loaders for the hosted booking pages (/book/...).

import { cache } from "react";
import { db } from "@/lib/db";
import { isModuleEnabled } from "@/lib/module-access";
import { publicType } from "./public";

/** The business and its active booking types, or null when booking is off. */
export const loadBookingBusiness = cache(async (pk: string) => {
  if (!pk || pk.length > 191) return null;
  const business = await db.business.findUnique({
    where: { publicKey: pk },
    select: { id: true, name: true, status: true, plan: true },
  });
  if (!business || business.status !== "active") return null;
  if (!(await isModuleEnabled(business.id, "leads", business.plan))) return null;
  const types = await db.bookingType.findMany({
    where: { businessId: business.id, active: true },
    orderBy: { createdAt: "asc" },
  });
  return { name: business.name, types: types.map(publicType) };
});
