import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/cn";

const variants = cva("inline-flex h-7 items-center justify-center gap-1.5 rounded-[4px] border px-2.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#002FA7] disabled:pointer-events-none disabled:opacity-45", {
  variants: {
    variant: {
      default: "border-[#002FA7] bg-[#002FA7] text-white hover:bg-[#002486]",
      secondary: "border-[var(--border)] bg-[var(--panel)] text-[var(--text)] hover:bg-[var(--hover)]",
      ghost: "border-transparent bg-transparent text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]",
      danger: "border-[#b42318] bg-[#b42318] text-white hover:bg-[#8f1b13]",
    },
  },
  defaultVariants: { variant: "secondary" },
});

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof variants>;
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, ...props }, ref) => <button ref={ref} className={cn(variants({ variant }), className)} {...props} />);
Button.displayName = "Button";
