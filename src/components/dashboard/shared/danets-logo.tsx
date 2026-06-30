import { ShieldCheck } from "lucide-react";

export function DanetsLogo({
  size = "md",
  variant = "full",
}: {
  size?: "sm" | "md" | "lg";
  variant?: "full" | "icon";
}) {
  const dims = size === "sm" ? "h-7 w-7" : size === "lg" ? "h-12 w-12" : "h-9 w-9";
  const iconSize = size === "sm" ? 16 : size === "lg" ? 26 : 20;
  const textCls =
    size === "sm" ? "text-base" : size === "lg" ? "text-2xl" : "text-lg";

  return (
    <div className="flex items-center gap-2">
      <div
        className={`${dims} rounded-xl brand-gradient flex items-center justify-center text-white shadow-md shrink-0`}
      >
        <ShieldCheck size={iconSize} strokeWidth={2.5} />
      </div>
      {variant === "full" && (
        <div className="leading-tight">
          <div className={`${textCls} font-bold tracking-tight`}>
            Danets<span className="text-primary"> AI</span>
          </div>
          {size !== "sm" && (
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground -mt-0.5">
              TecPro Automation
            </div>
          )}
        </div>
      )}
    </div>
  );
}
