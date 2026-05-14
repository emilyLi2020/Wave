"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface SidebarLinkProps {
  href: string;
  label: string;
}

export function SidebarLink({ href, label }: SidebarLinkProps) {
  const pathname = usePathname();
  const isActive =
    pathname === href ||
    (href !== "/models" && pathname?.startsWith(`${href}/`));

  return (
    <Link
      href={href}
      className={`block rounded-lg px-3 py-2 text-sm transition-colors ${
        isActive
          ? "bg-accent-soft text-accent font-medium"
          : "text-foreground/75 hover:bg-surface-muted hover:text-foreground"
      }`}
    >
      {label}
    </Link>
  );
}
