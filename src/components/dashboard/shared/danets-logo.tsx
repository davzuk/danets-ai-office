import { ShieldCheck } from "lucide-react";

export function DanetsLogo({
  size = "md",
  variant = "full",
  brand,
}: {
  size?: "sm" | "md" | "lg";
  variant?: "full" | "icon";
  brand?: { appName?: string; customLogoUrl?: string | null; hideBranding?: boolean; primaryColor?: string } | null;
}) {
  const dims = size === "sm" ? "h-7 w-7" : size === "lg" ? "h-12 w-12" : "h-9 w-9";
  const iconSize = size === "sm" ? 16 : size === "lg" ? 26 : 20;
  const textCls = size === "sm" ? "text-base" : size === "lg" ? "text-2xl" : "text-lg";

  const name = brand?.appName?.trim() || null;

  return (
    <div className="flex items-center gap-2">
      <div
        className={`${dims} rounded-xl flex items-center justify-center text-white shadow-md shrink-0 overflow-hidden ${brand?.primaryColor ? "" : "brand-gradient"}`}
        style={brand?.primaryColor ? { background: brand.primaryColor } : undefined}
      >
        {brand?.customLogoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={brand.customLogoUrl} alt={name ?? "Logo"} className="h-full w-full object-contain p-1" />
        ) : (
          <ShieldCheck size={iconSize} strokeWidth={2.5} />
        )}
      </div>
      {variant === "full" && (
        <div className="leading-tight">
          <div className={`${textCls} font-bold tracking-tight`}>
            {name ?? (
              <>
                Danets<span className="text-primary"> AI</span>
              </>
            )}
          </div>
          {size !== "sm" && !name && !brand?.hideBranding && (
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground -mt-0.5">
              TecPro Automation
            </div>
          )}
        </div>
      )}
    </div>
  );
}