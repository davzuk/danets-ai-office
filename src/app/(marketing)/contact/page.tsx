import type { Metadata } from "next";
import { ContactForm } from "@/components/marketing/contact-form";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Contact — Danets AI Automation",
  description:
    "Talk to the Danets TecPro team. Enterprise pricing, custom integrations, demos and partnerships.",
};

export default function ContactPage() {
  return (
    <section className="py-16 sm:py-24">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 grid md:grid-cols-2 gap-12">
        <div className="space-y-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-primary">
            Contact
          </div>
          <h1 className="text-4xl font-bold tracking-tight">Talk to our team</h1>
          <p className="text-lg text-muted-foreground leading-relaxed">
            Whether you need a demo, an enterprise quote, or a custom
            integration, fill out the form and someone from our team will get
            back to you within one business day.
          </p>
          <ul className="space-y-3 text-sm">
            <li className="flex items-start gap-3">
              <span className="h-1.5 w-1.5 rounded-full bg-primary mt-2 shrink-0" />
              <span>
                <strong className="text-foreground">Sales:</strong> pricing,
                plans, and demos for your team.
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="h-1.5 w-1.5 rounded-full bg-primary mt-2 shrink-0" />
              <span>
                <strong className="text-foreground">Partnerships:</strong>{" "}
                integrations, agencies, and resellers.
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="h-1.5 w-1.5 rounded-full bg-primary mt-2 shrink-0" />
              <span>
                <strong className="text-foreground">Support:</strong> existing
                customer? Use the in-app help channel for the fastest response.
              </span>
            </li>
          </ul>
        </div>

        <ContactForm />
      </div>
    </section>
  );
}