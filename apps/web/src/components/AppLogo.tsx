import { cn } from "~/lib/utils";

interface AppLogoProps {
  alt?: string;
  className?: string;
  decorative?: boolean;
}

export function AppLogo({ alt = "Flow", className, decorative = false }: AppLogoProps) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-xl ring-1 ring-white/6 shadow-[0_12px_28px_-16px_rgba(0,0,0,0.55)]",
        className,
      )}
    >
      <img
        src="/icon.png"
        alt={decorative ? "" : alt}
        aria-hidden={decorative ? true : undefined}
        className="block size-full rounded-[inherit]"
      />
    </span>
  );
}
