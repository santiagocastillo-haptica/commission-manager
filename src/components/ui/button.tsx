import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

/*
  Botón Háptica: forma única, cuadrada (nunca redondeada), en mayúsculas y con tracking.
  `default` = acción principal (verde petróleo). `accent` = naranja de marca, para un único
  llamado destacado por pantalla. `destructive` usa el naranja en versión suave.
*/
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-none border border-transparent bg-clip-padding text-xs font-bold uppercase tracking-[0.08em] whitespace-nowrap transition-colors outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/40 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-brand-deep",
        accent: "bg-brand-orange text-white hover:bg-[#d93a0e]",
        outline:
          "border-primary bg-background text-primary hover:bg-accent aria-expanded:bg-accent",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[#e9e9e5] aria-expanded:bg-secondary",
        ghost:
          "text-secondary-foreground hover:bg-muted aria-expanded:bg-muted",
        destructive:
          "border-danger/30 bg-danger-soft text-danger hover:bg-[#ffd9cd] focus-visible:ring-destructive/20",
        link: "tracking-normal normal-case text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-9 gap-2 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        xs: "h-6 gap-1 px-2 text-[10px] [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 px-3 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-11 gap-2 px-6 text-sm",
        icon: "size-9",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      // Si se renderiza como otro elemento (p. ej. un enlace), ya no es un <button> nativo.
      {...(props.render ? { nativeButton: false } : {})}
      {...props}
    />
  )
}

export { Button, buttonVariants }
